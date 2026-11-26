\set ON_ERROR_STOP on

-- Run against an isolated test database after applying all migrations.
-- Fixtures and all subscription/resource changes are rolled back.
begin;

select gen_random_uuid() as owner_id,
       gen_random_uuid() as second_owner_id,
       gen_random_uuid() as existing_staff_id,
       gen_random_uuid() as invited_staff_id,
       gen_random_uuid() as farm_id,
       gen_random_uuid() as second_farm_id
\gset

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (:'owner_id'::uuid, 'authenticated', 'authenticated',
   's3-owner-' || :'owner_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  (:'second_owner_id'::uuid, 'authenticated', 'authenticated',
   's3-owner-' || :'second_owner_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  (:'existing_staff_id'::uuid, 'authenticated', 'authenticated',
   's3-staff-' || :'existing_staff_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  (:'invited_staff_id'::uuid, 'authenticated', 'authenticated',
   's3-invite-' || :'invited_staff_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb);

insert into public.farms (id, name, created_by)
values
  (:'farm_id'::uuid, 'S3 batch quota test farm', :'owner_id'::uuid),
  (:'second_farm_id'::uuid, 'S3 staff quota test farm', :'second_owner_id'::uuid);

insert into public.farm_memberships (farm_id, user_id, role)
values
  (:'farm_id'::uuid, :'owner_id'::uuid, 'owner'),
  (:'farm_id'::uuid, :'existing_staff_id'::uuid, 'attendant'),
  (:'second_farm_id'::uuid, :'second_owner_id'::uuid, 'owner'),
  (:'second_farm_id'::uuid, :'existing_staff_id'::uuid, 'owner');

select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('flockledger.test.farm_id', :'farm_id', true);
select set_config('flockledger.test.second_farm_id', :'second_farm_id', true);
select set_config('flockledger.test.owner_id', :'owner_id', true);
select set_config('flockledger.test.second_owner_id', :'second_owner_id', true);
select set_config('flockledger.test.existing_staff_id', :'existing_staff_id', true);
select set_config('flockledger.test.invited_staff_id', :'invited_staff_id', true);
set local role authenticated;

do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  v_other_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  result jsonb;
  rejected boolean := false;
begin
  result := public.get_farm_entitlements(v_farm_id);
  if result #>> '{effectivePlan,code}' <> 'starter'
    or result #>> '{limits,max_active_batches}' <> '2'
    or result #>> '{limits,max_staff_users}' <> '2' then
    raise exception 'Starter quotas should be two active batches and two additional staff.';
  end if;

  perform public.create_batch_with_quota(
    v_farm_id, 'S3-STARTER-1', 'Broiler', null, null, current_date,
    null, null, 0, 100, null
  );
  perform public.create_batch_with_quota(
    v_farm_id, 'S3-STARTER-2', 'Kienyeji', null, null, current_date,
    null, null, 0, 100, null
  );

  begin
    perform public.create_batch_with_quota(
      v_farm_id, 'S3-STARTER-3', 'Broiler', null, null, current_date,
      null, null, 0, 100, null
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'ACTIVE_BATCH_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'Starter must reject a third active batch.';
  end if;

  update public.batches
  set status = 'closed', date_sold_out = current_date
  where farm_id = v_farm_id and batch_code = 'S3-STARTER-1';
  perform public.create_batch_with_quota(
    v_farm_id, 'S3-STARTER-3', 'Broiler', null, null, current_date,
    null, null, 0, 100, null
  );

  result := public.start_professional_trial(v_farm_id);
  if result ->> 'status' <> 'trialing' then
    raise exception 'Professional trial setup failed for quota testing.';
  end if;

  for index in 1..8 loop
    perform public.create_batch_with_quota(
      v_farm_id, 'S3-PRO-' || lpad(index::text, 2, '0'), 'Broiler',
      null, null, current_date, null, null, 0, 100, null
    );
  end loop;

  rejected := false;
  begin
    perform public.create_batch_with_quota(
      v_farm_id, 'S3-PRO-OVER', 'Broiler', null, null, current_date,
      null, null, 0, 100, null
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'ACTIVE_BATCH_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'Professional must reject an eleventh active batch.';
  end if;

  rejected := false;
  begin
    perform public.create_batch_with_quota(
      v_other_farm_id, 'S3-CROSS-FARM', 'Broiler', null, null, current_date,
      null, null, 0, 100, null
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Batch creation must reject cross-farm requests.';
  end if;

  rejected := false;
  begin
    perform public.reserve_farm_staff_seat(
      v_other_farm_id,
      's3-cross-farm-' || current_setting('flockledger.test.owner_id') || '@example.invalid',
      'attendant',
      null,
      repeat('9', 64),
      repeat('8', 64)
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Staff seat reservation must reject cross-farm requests.';
  end if;
end;
$$;

reset role;
update public.farm_subscriptions
set plan_id = (select id from public.subscription_plans where code = 'starter'),
    status = 'active'
where farm_id = :'farm_id'::uuid
  and status = 'trialing';

select set_config('request.jwt.claim.sub', :'owner_id', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  rejected boolean := false;
begin
  if (select count(*) from public.batches where farm_id = v_farm_id and status = 'running') <> 10 then
    raise exception 'Downgrading must retain existing running batches.';
  end if;
  begin
    perform public.create_batch_with_quota(
      v_farm_id, 'S3-DOWNGRADE-BLOCK', 'Broiler', null, null, current_date,
      null, null, 0, 100, null
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'ACTIVE_BATCH_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'A downgrade over the current usage must block new batches.';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
select public.get_farm_entitlements(:'second_farm_id'::uuid);

reset role;
update public.plan_features
set limit_value = case feature_key
  when 'max_active_batches' then 3
  when 'max_staff_users' then 1
  else limit_value
end
where plan_id = (select id from public.subscription_plans where code = 'enterprise')
  and feature_key in ('max_active_batches', 'max_staff_users');
update public.farm_subscriptions
set plan_id = (select id from public.subscription_plans where code = 'enterprise'),
    status = 'active'
where farm_id = :'second_farm_id'::uuid;

select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  result jsonb;
  rejected boolean := false;
begin
  result := public.get_farm_entitlements(v_farm_id);
  if result #>> '{effectivePlan,code}' <> 'enterprise'
    or result #>> '{limits,max_active_batches}' <> '3'
    or result #>> '{limits,max_staff_users}' <> '1' then
    raise exception 'Enterprise limits should use the configured database values.';
  end if;

  for index in 1..3 loop
    perform public.create_batch_with_quota(
      v_farm_id, 'S3-ENT-' || lpad(index::text, 2, '0'), 'Broiler',
      null, null, current_date, null, null, 0, 100, null
    );
  end loop;
  begin
    perform public.create_batch_with_quota(
      v_farm_id, 'S3-ENT-OVER', 'Broiler', null, null, current_date,
      null, null, 0, 100, null
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'ACTIVE_BATCH_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'Enterprise must enforce its configured active-batch limit.';
  end if;

  result := public.get_farm_subscription_usage(v_farm_id);
  if (result ->> 'staffUsers')::integer <> 0 then
    raise exception 'The farm owner must not consume an additional staff seat.';
  end if;
end;
$$;

select (
  public.reserve_farm_staff_seat(
    :'second_farm_id'::uuid,
    's3-invite-' || :'invited_staff_id' || '@example.invalid',
    'attendant',
    'Invited Staff',
    repeat('a', 64),
    repeat('b', 64)
  ) ->> 'reservationId'
) as reservation_id
\gset
select set_config('flockledger.test.reservation_id', :'reservation_id', true);

select (
  public.reserve_farm_staff_seat(
    :'second_farm_id'::uuid,
    's3-invite-' || :'invited_staff_id' || '@example.invalid',
    'attendant',
    'Invited Staff',
    repeat('a', 64),
    repeat('b', 64)
  ) ->> 'reservationId'
) as repeated_reservation_id
\gset
select set_config('flockledger.test.repeated_reservation_id', :'repeated_reservation_id', true);
do $$
begin
  if current_setting('flockledger.test.reservation_id')
    <> current_setting('flockledger.test.repeated_reservation_id') then
    raise exception 'Repeated reservation requests must be idempotent.';
  end if;
end;
$$;

do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  rejected boolean := false;
begin
  begin
    perform public.reserve_farm_staff_seat(
      v_farm_id,
      's3-another-' || current_setting('flockledger.test.owner_id') || '@example.invalid',
      'attendant',
      null,
      repeat('c', 64),
      repeat('d', 64)
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'STAFF_SEAT_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'The owner-excluded Enterprise staff limit must reject an extra seat.';
  end if;

  rejected := false;
  begin
    perform public.update_farm_member_role(
      v_farm_id,
      current_setting('flockledger.test.existing_staff_id')::uuid,
      'attendant'
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'STAFF_SEAT_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'Demoting an additional owner to staff must respect the staff quota.';
  end if;
end;
$$;

reset role;
update public.farm_staff_seat_reservations
set status = 'provisioned',
    auth_user_id = :'invited_staff_id'::uuid,
    expires_at = statement_timestamp() + interval '7 days'
where id = :'reservation_id'::uuid;

insert into public.farm_invitations (
  farm_id, email, role, invited_by, status, full_name,
  setup_token_hash, setup_expires_at, reservation_id
) values (
  :'second_farm_id'::uuid,
  's3-invite-' || :'invited_staff_id' || '@example.invalid',
  'attendant',
  :'second_owner_id'::uuid,
  'pending',
  'Invited Staff',
  repeat('e', 64),
  statement_timestamp() + interval '7 days',
  :'reservation_id'::uuid
);

select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  usage_result jsonb;
begin
  usage_result := public.get_farm_subscription_usage(v_farm_id);
  if (usage_result ->> 'staffUsers')::integer <> 1 then
    raise exception 'A pending invitation must occupy exactly one reserved seat.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'invited_staff_id', true);
select public.consume_staff_setup_token(repeat('e', 64));
select public.accept_farm_invitations();
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  usage_result jsonb;
begin
  usage_result := public.get_farm_subscription_usage(v_farm_id);
  if (usage_result ->> 'staffUsers')::integer <> 1
    or not exists (
      select 1 from public.farm_memberships
      where farm_id = v_farm_id
        and user_id = current_setting('flockledger.test.invited_staff_id')::uuid
        and role = 'attendant'
    ) then
    raise exception 'Acceptance must atomically replace the reservation with one membership seat.';
  end if;
end;
$$;

reset role;
do $$
begin
  if (select status from public.farm_staff_seat_reservations
      where id = current_setting('flockledger.test.reservation_id')::uuid) <> 'consumed' then
    raise exception 'Acceptance must mark the reservation consumed.';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
delete from public.farm_memberships
where farm_id = :'second_farm_id'::uuid and user_id = :'invited_staff_id'::uuid;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  usage_result jsonb;
begin
  usage_result := public.get_farm_subscription_usage(v_farm_id);
  if (usage_result ->> 'staffUsers')::integer <> 0
    or exists (
      select 1 from public.farm_invitations
      where reservation_id = current_setting('flockledger.test.reservation_id')::uuid
        and status <> 'cancelled'
    ) then
    raise exception 'Staff removal must release the seat and cancel the accepted invitation.';
  end if;
end;
$$;

reset role;
insert into public.farm_memberships (farm_id, user_id, role)
values (
  :'second_farm_id'::uuid,
  :'invited_staff_id'::uuid,
  'attendant'
);
update public.farm_invitations invitation
set status = 'accepted',
    accepted_at = statement_timestamp(),
    reservation_id = null
where invitation.farm_id = :'second_farm_id'::uuid
  and lower(invitation.email) = (
    select lower(account.email)
    from auth.users account
    where account.id = :'invited_staff_id'::uuid
  );

select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
delete from public.farm_memberships
where farm_id = :'second_farm_id'::uuid and user_id = :'invited_staff_id'::uuid;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  usage_result jsonb;
begin
  usage_result := public.get_farm_subscription_usage(v_farm_id);
  if (usage_result ->> 'staffUsers')::integer <> 0
    or exists (
      select 1 from public.farm_invitations
      where farm_id = v_farm_id
        and lower(email) like 's3-invite-%'
        and status <> 'cancelled'
    ) then
    raise exception 'Removing a legacy accepted member must release the seat and cancel its invitation.';
  end if;
end;
$$;

reset role;
insert into public.farm_invitations (
  farm_id, email, role, invited_by, status, setup_expires_at
) values
  (
    :'second_farm_id'::uuid,
    's3-pending-' || :'owner_id' || '@example.invalid',
    'attendant',
    :'second_owner_id'::uuid,
    'pending',
    statement_timestamp() + interval '1 day'
  ),
  (
    :'second_farm_id'::uuid,
    's3-expired-' || :'owner_id' || '@example.invalid',
    'attendant',
    :'second_owner_id'::uuid,
    'pending',
    statement_timestamp() - interval '1 day'
  );

select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  usage_result jsonb;
  rejected boolean := false;
begin
  usage_result := public.get_farm_subscription_usage(v_farm_id);
  if (usage_result ->> 'staffUsers')::integer <> 1 then
    raise exception 'A non-expired pending invitation counts, but an expired one does not.';
  end if;

  begin
    perform public.reserve_farm_staff_seat(
      v_farm_id,
      's3-reserved-' || current_setting('flockledger.test.owner_id') || '@example.invalid',
      'attendant',
      null,
      repeat('f', 64),
      repeat('0', 64)
    );
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = 'STAFF_SEAT_QUOTA_EXCEEDED';
  end;
  if not rejected then
    raise exception 'An unexpired pending invitation must occupy a staff seat.';
  end if;
end;
$$;

reset role;
update public.farm_invitations
set status = 'cancelled'
where farm_id = :'second_farm_id'::uuid
  and email = 's3-pending-' || :'owner_id' || '@example.invalid';

select set_config('request.jwt.claim.sub', :'second_owner_id', true);
set local role authenticated;
select (
  public.reserve_farm_staff_seat(
    :'second_farm_id'::uuid,
    's3-failed-auth-' || :'owner_id' || '@example.invalid',
    'attendant',
    null,
    repeat('1', 64),
    repeat('2', 64)
  ) ->> 'reservationId'
) as failed_reservation_id
\gset
select set_config('flockledger.test.failed_reservation_id', :'failed_reservation_id', true);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.release_farm_staff_seat_reservation(:'failed_reservation_id'::uuid);
select public.release_farm_staff_seat_reservation(:'failed_reservation_id'::uuid);
reset role;
select set_config('request.jwt.claim.sub', :'second_owner_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  if (select status from public.farm_staff_seat_reservations
      where id = current_setting('flockledger.test.failed_reservation_id')::uuid) <> 'released' then
    raise exception 'Auth provisioning compensation must release its reserved seat idempotently.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'second_owner_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.update_farm_member_role(
  :'second_farm_id'::uuid,
  :'existing_staff_id'::uuid,
  'attendant'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.create_batch_with_quota(
      current_setting('flockledger.test.farm_id')::uuid,
      'S3-ANONYMOUS',
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
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Anonymous batch creation must be rejected.';
  end if;
end;
$$;

rollback;
