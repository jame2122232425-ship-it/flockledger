if (-not $env:FLOCKLEDGER_TEST_PROJECT_CONFIRMED -or $env:FLOCKLEDGER_TEST_PROJECT_CONFIRMED -ne "yes") {
  throw "Set FLOCKLEDGER_TEST_PROJECT_CONFIRMED=yes only after confirming the isolated test project."
}

$databaseUrl = $env:FLOCKLEDGER_TEST_DATABASE_URL
if (-not $databaseUrl -or $databaseUrl -notmatch '^postgres(ql)?://') {
  throw "Set FLOCKLEDGER_TEST_DATABASE_URL to the confirmed isolated test database."
}
if (-not (Get-Command psql.exe -ErrorAction SilentlyContinue) -or
    -not (Get-Command pgbench.exe -ErrorAction SilentlyContinue)) {
  throw "PostgreSQL psql and pgbench tools are required."
}

$ownerId = [guid]::NewGuid().ToString()
$staffId = [guid]::NewGuid().ToString()
$farmId = [guid]::NewGuid().ToString()
$triggerSuffix = $farmId.Replace("-", "")
$delayFunction = "s3_quota_delay_$triggerSuffix"
$batchTrigger = "s3_batch_delay_$triggerSuffix"
$staffTrigger = "s3_staff_delay_$triggerSuffix"
$resultsTable = "s3_quota_results_$triggerSuffix"
$batchAttemptFunction = "s3_batch_attempt_$triggerSuffix"
$staffAttemptFunction = "s3_staff_attempt_$triggerSuffix"
$batchScript = [System.IO.Path]::GetTempFileName()
$staffScript = [System.IO.Path]::GetTempFileName()
$fixtureCreated = $false

function Invoke-TestPsql([string]$Sql) {
  $result = & psql.exe $databaseUrl -X -v ON_ERROR_STOP=1 -Atc $Sql 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Test database command failed: $($result -join ' ')"
  }
  return $result
}

function Invoke-Pgbench([string]$ScriptPath) {
  $result = & pgbench.exe -n -c 2 -j 2 -t 1 -f $ScriptPath $databaseUrl 2>&1
  $exitCode = $LASTEXITCODE
  $text = $result -join "`n"
  if ($exitCode -ne 0) {
    throw "pgbench exited with $exitCode`: $text"
  }
  if ($text -notmatch 'number of transactions actually processed:\s*2') {
    throw "Expected two concurrent pgbench transactions`: $text"
  }
  Write-Output $text
}

try {
  $setupSql = @'
begin;
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('__OWNER_ID__', 'authenticated', 'authenticated',
   's3-concurrency-owner-__OWNER_ID__@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('__STAFF_ID__', 'authenticated', 'authenticated',
   's3-concurrency-staff-__STAFF_ID__@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb);

insert into public.farms (id, name, created_by)
values ('__FARM_ID__', 'S3 quota concurrency test farm', '__OWNER_ID__');
insert into public.farm_memberships (farm_id, user_id, role)
values ('__FARM_ID__', '__OWNER_ID__', 'owner'),
       ('__FARM_ID__', '__STAFF_ID__', 'attendant');

update public.subscription_enforcement_config
set enabled = true
where singleton;

select set_config('request.jwt.claim.sub', '__OWNER_ID__', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.get_farm_entitlements('__FARM_ID__'::uuid);
reset role;

insert into public.batches (
  farm_id, batch_code, batch_type, date_placed, chicks_ordered,
  chicks_received, created_by
) values (
  '__FARM_ID__', 'S3-CONCURRENCY-BASE', 'Broiler', current_date, 0, 100, '__OWNER_ID__'
);

create function public.__DELAY_FUNCTION__()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.farm_id = '__FARM_ID__'::uuid then
    perform pg_catalog.pg_sleep(1);
  end if;
  return new;
end;
$$;
create trigger __BATCH_TRIGGER__
before insert on public.batches
for each row execute function public.__DELAY_FUNCTION__();
create trigger __STAFF_TRIGGER__
before insert on public.farm_staff_seat_reservations
for each row execute function public.__DELAY_FUNCTION__();

create table public.__RESULTS_TABLE__ (
  farm_id uuid not null,
  operation text not null,
  backend_pid integer not null,
  outcome text not null,
  primary key (farm_id, operation, backend_pid)
);
alter table public.__RESULTS_TABLE__ disable row level security;
grant insert on public.__RESULTS_TABLE__ to authenticated;

create function public.__BATCH_ATTEMPT_FUNCTION__()
returns text
language plpgsql
set search_path = ''
as $$
declare
  outcome text;
begin
  begin
    perform public.create_batch_with_quota(
      '__FARM_ID__'::uuid,
      'S3-CONCURRENT-' || pg_backend_pid()::text,
      'Broiler',
      null,
      null,
      current_date,
      null,
      null,
      0,
      100,
      null
    );
    outcome := 'accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'ACTIVE_BATCH_QUOTA_EXCEEDED' then
      raise;
    end if;
    outcome := 'quota_rejected';
  end;
  insert into public.__RESULTS_TABLE__ (farm_id, operation, backend_pid, outcome)
  values ('__FARM_ID__'::uuid, 'batch', pg_backend_pid(), outcome);
  return outcome;
end;
$$;
grant execute on function public.__BATCH_ATTEMPT_FUNCTION__() to authenticated;

create function public.__STAFF_ATTEMPT_FUNCTION__()
returns text
language plpgsql
set search_path = ''
as $$
declare
  outcome text;
begin
  begin
    perform public.reserve_farm_staff_seat(
      '__FARM_ID__'::uuid,
      's3-concurrent-' || pg_backend_pid()::text || '@example.invalid',
      'attendant',
      null,
      md5('staff-key-' || pg_backend_pid()::text) || md5('staff-key-2-' || pg_backend_pid()::text),
      md5('staff-payload-' || pg_backend_pid()::text) || md5('staff-payload-2-' || pg_backend_pid()::text)
    );
    outcome := 'accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STAFF_SEAT_QUOTA_EXCEEDED' then
      raise;
    end if;
    outcome := 'quota_rejected';
  end;
  insert into public.__RESULTS_TABLE__ (farm_id, operation, backend_pid, outcome)
  values ('__FARM_ID__'::uuid, 'staff', pg_backend_pid(), outcome);
  return outcome;
end;
$$;
grant execute on function public.__STAFF_ATTEMPT_FUNCTION__() to authenticated;
commit;
'@

  $setupSql = $setupSql.Replace("__OWNER_ID__", $ownerId)
  $setupSql = $setupSql.Replace("__STAFF_ID__", $staffId)
  $setupSql = $setupSql.Replace("__FARM_ID__", $farmId)
  $setupSql = $setupSql.Replace("__DELAY_FUNCTION__", $delayFunction)
  $setupSql = $setupSql.Replace("__BATCH_TRIGGER__", $batchTrigger)
  $setupSql = $setupSql.Replace("__STAFF_TRIGGER__", $staffTrigger)
  $setupSql = $setupSql.Replace("__RESULTS_TABLE__", $resultsTable)
  $setupSql = $setupSql.Replace("__BATCH_ATTEMPT_FUNCTION__", $batchAttemptFunction)
  $setupSql = $setupSql.Replace("__STAFF_ATTEMPT_FUNCTION__", $staffAttemptFunction)
  Invoke-TestPsql $setupSql | Out-Null
  $fixtureCreated = $true

  $batchSql = @'
select set_config('request.jwt.claim.sub', '__OWNER_ID__', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
select public.__BATCH_ATTEMPT_FUNCTION__();
'@
  $batchSql = $batchSql.Replace("__BATCH_ATTEMPT_FUNCTION__", $batchAttemptFunction)
  [System.IO.File]::WriteAllText(
    $batchScript,
    $batchSql.Replace("__OWNER_ID__", $ownerId).Replace("__FARM_ID__", $farmId)
  )
  Invoke-Pgbench $batchScript | Out-Null

  $batchCount = (Invoke-TestPsql "select count(*) from public.batches where farm_id = '$farmId' and status = 'running';" | Select-Object -Last 1).Trim()
  if ($batchCount -ne "2") {
    throw "Concurrent batch test expected exactly two running batches, found $batchCount."
  }
  $batchOutcomes = (Invoke-TestPsql "select count(*) filter (where outcome = 'accepted') || '|' || count(*) filter (where outcome = 'quota_rejected') from public.$resultsTable where operation = 'batch';" | Select-Object -Last 1).Trim()
  if ($batchOutcomes -ne "1|1") {
    throw "Concurrent batch test expected one acceptance and one quota rejection, found $batchOutcomes."
  }
  Write-Output "Concurrent batch boundary: 2 requests, 1 accepted, 1 quota-rejected."

  $staffSql = @'
select set_config('request.jwt.claim.sub', '__OWNER_ID__', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
select public.__STAFF_ATTEMPT_FUNCTION__();
'@
  $staffSql = $staffSql.Replace("__STAFF_ATTEMPT_FUNCTION__", $staffAttemptFunction)
  [System.IO.File]::WriteAllText(
    $staffScript,
    $staffSql.Replace("__OWNER_ID__", $ownerId).Replace("__FARM_ID__", $farmId)
  )
  Invoke-Pgbench $staffScript | Out-Null

  $reservationCount = (Invoke-TestPsql "select count(*) from public.farm_staff_seat_reservations where farm_id = '$farmId' and email like 's3-concurrent-%' and status in ('reserved', 'provisioned');" | Select-Object -Last 1).Trim()
  if ($reservationCount -ne "1") {
    throw "Concurrent staff test expected exactly one occupied reservation, found $reservationCount."
  }
  $staffOutcomes = (Invoke-TestPsql "select count(*) filter (where outcome = 'accepted') || '|' || count(*) filter (where outcome = 'quota_rejected') from public.$resultsTable where operation = 'staff';" | Select-Object -Last 1).Trim()
  if ($staffOutcomes -ne "1|1") {
    throw "Concurrent staff test expected one reservation and one quota rejection, found $staffOutcomes."
  }
  Write-Output "Concurrent staff boundary: 2 requests, 1 reserved, 1 quota-rejected."
}
finally {
  if ($fixtureCreated) {
    $cleanupSql = @'
begin;
drop trigger if exists __BATCH_TRIGGER__ on public.batches;
drop trigger if exists __STAFF_TRIGGER__ on public.farm_staff_seat_reservations;
drop function if exists public.__DELAY_FUNCTION__();
drop function if exists public.__BATCH_ATTEMPT_FUNCTION__();
drop function if exists public.__STAFF_ATTEMPT_FUNCTION__();
drop table if exists public.__RESULTS_TABLE__;
alter table public.subscription_events disable trigger user;
delete from public.subscription_events where farm_id = '__FARM_ID__'::uuid;
alter table public.subscription_events enable trigger user;
alter table public.farm_memberships disable trigger user;
alter table public.batches disable trigger user;
delete from public.farms where id = '__FARM_ID__'::uuid;
alter table public.farm_memberships enable trigger user;
alter table public.batches enable trigger user;
delete from auth.users where id in ('__OWNER_ID__'::uuid, '__STAFF_ID__'::uuid);
update public.subscription_enforcement_config
set enabled = false
where singleton;
commit;
'@
    $cleanupSql = $cleanupSql.Replace("__BATCH_TRIGGER__", $batchTrigger)
    $cleanupSql = $cleanupSql.Replace("__STAFF_TRIGGER__", $staffTrigger)
    $cleanupSql = $cleanupSql.Replace("__DELAY_FUNCTION__", $delayFunction)
    $cleanupSql = $cleanupSql.Replace("__BATCH_ATTEMPT_FUNCTION__", $batchAttemptFunction)
    $cleanupSql = $cleanupSql.Replace("__STAFF_ATTEMPT_FUNCTION__", $staffAttemptFunction)
    $cleanupSql = $cleanupSql.Replace("__RESULTS_TABLE__", $resultsTable)
    $cleanupSql = $cleanupSql.Replace("__FARM_ID__", $farmId)
    $cleanupSql = $cleanupSql.Replace("__OWNER_ID__", $ownerId)
    $cleanupSql = $cleanupSql.Replace("__STAFF_ID__", $staffId)
    Invoke-TestPsql $cleanupSql | Out-Null
  }
  Remove-Item -LiteralPath $batchScript, $staffScript -ErrorAction SilentlyContinue
}
