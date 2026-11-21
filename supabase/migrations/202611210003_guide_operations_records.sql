alter table public.health_records
  add column vaccine_batch_number text,
  add column product_expiry_date date,
  add column reaction text,
  add column post_mortem_findings text,
  add column suspected_cause text,
  add column action_taken text,
  add column veterinarian_consulted boolean,
  add constraint health_records_product_expiry_after_record
    check (product_expiry_date is null or product_expiry_date >= record_date);

create table public.brooding_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid not null,
  observation_date date not null,
  observation_time time not null,
  brooder_temp_c numeric(5, 1),
  house_temp_c numeric(5, 1),
  humidity_percent numeric(5, 2) check (humidity_percent between 0 and 100),
  chick_behavior text check (chick_behavior in ('spread', 'huddled', 'panting', 'other')),
  behavior_details text,
  action_taken text,
  initials text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete cascade,
  check (brooder_temp_c is not null or house_temp_c is not null
    or humidity_percent is not null or chick_behavior is not null)
);

create table public.biosecurity_visits (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  visit_date date not null,
  time_in time not null,
  visitor_name text not null,
  organization_purpose text,
  last_poultry_premises text,
  footbath_used boolean not null default false,
  protective_clothing_used boolean not null default false,
  signature text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.house_activity_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid,
  activity_date date not null,
  house text not null,
  activity_type text not null check (activity_type in ('litter_check', 'cleanout', 'disinfection', 'downtime')),
  litter_condition text,
  ammonia_observation text,
  disinfectant text,
  downtime_start date,
  downtime_end date,
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id),
  check (downtime_end is null or downtime_start is not null),
  check (downtime_start is null or downtime_end is null or downtime_end >= downtime_start),
  check (activity_type <> 'downtime' or downtime_start is not null)
);

create table public.labour_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid,
  record_type text not null check (record_type in ('attendance', 'payroll')),
  record_date date not null,
  worker_name text not null,
  hours_worked numeric(6, 2) check (hours_worked >= 0),
  pay_period_start date,
  pay_period_end date,
  amount_kes numeric(12, 2) not null default 0 check (amount_kes >= 0),
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id),
  check (
    (record_type = 'attendance' and hours_worked is not null
      and pay_period_start is null and pay_period_end is null)
    or (record_type = 'payroll' and amount_kes > 0
      and pay_period_start is not null and pay_period_end is not null
      and pay_period_end >= pay_period_start)
  )
);

create table public.utility_usage (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid,
  usage_date date not null,
  house text,
  utility_type text not null check (utility_type in ('electricity', 'water', 'fuel', 'gas', 'charcoal', 'other')),
  quantity numeric(12, 3) not null check (quantity >= 0),
  unit text not null,
  meter_reading numeric(12, 3) check (meter_reading >= 0),
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id)
);

alter table public.assets
  add constraint assets_farm_id_id_key unique (farm_id, id);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid,
  asset_id uuid,
  record_date date not null,
  house text,
  description text not null,
  work_done text,
  service_provider text,
  status text not null default 'reported' check (status in ('reported', 'in_progress', 'completed')),
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id),
  foreign key (farm_id, asset_id) references public.assets(farm_id, id) on delete set null (asset_id)
);

create table public.compliance_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  document_type text not null,
  document_number text,
  issuing_authority text,
  issued_date date,
  expiry_date date,
  storage_path text,
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (issued_date is null or expiry_date is null or expiry_date >= issued_date)
);

create index brooding_observations_batch_date_idx
  on public.brooding_observations(farm_id, batch_id, observation_date desc, observation_time desc);
create index biosecurity_visits_farm_date_idx
  on public.biosecurity_visits(farm_id, visit_date desc);
create index house_activity_records_farm_date_idx
  on public.house_activity_records(farm_id, activity_date desc);
create index labour_records_farm_date_idx
  on public.labour_records(farm_id, record_date desc);
create index utility_usage_farm_date_idx
  on public.utility_usage(farm_id, usage_date desc);
create index maintenance_records_farm_date_idx
  on public.maintenance_records(farm_id, record_date desc);
create index compliance_records_farm_expiry_idx
  on public.compliance_records(farm_id, expiry_date);

create or replace function public.validate_batch_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
  batch_placed date;
  initial_birds integer;
  activity_date date;
  existing_losses bigint;
  existing_sales bigint;
  total_losses bigint;
  total_sales bigint;
  excluded_record_id uuid;
begin
  target_batch_id := new.batch_id;
  if target_batch_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    excluded_record_id := old.id;
  end if;

  select date_placed, chicks_received
    into batch_placed, initial_birds
    from public.batches
    where id = target_batch_id and farm_id = new.farm_id
    for update;

  if batch_placed is null then
    raise exception 'Batch not found for farm';
  end if;

  if tg_table_name in ('daily_records', 'weight_records', 'health_records') then
    activity_date := new.record_date;
  elsif tg_table_name = 'feed_deliveries' then
    activity_date := new.delivery_date;
  elsif tg_table_name = 'sales' then
    activity_date := new.sale_date;
  elsif tg_table_name = 'cash_entries' then
    activity_date := new.entry_date;
  elsif tg_table_name = 'stock_movements' then
    activity_date := new.movement_date;
  end if;

  if activity_date < batch_placed then
    raise exception 'Record date cannot be before batch placement';
  end if;

  if tg_table_name in ('daily_records', 'sales') then
    select coalesce(sum(dead + culled), 0)
      into existing_losses
      from public.daily_records
      where batch_id = target_batch_id
        and (excluded_record_id is null or id <> excluded_record_id);

    select coalesce(sum(birds_sold), 0)
      into existing_sales
      from public.sales
      where batch_id = target_batch_id
        and (excluded_record_id is null or id <> excluded_record_id);

    total_losses := existing_losses;
    total_sales := existing_sales;
    if tg_table_name = 'daily_records' then
      total_losses := total_losses + new.dead + new.culled;
    else
      total_sales := total_sales + new.birds_sold;
    end if;

    if total_losses + total_sales > initial_birds then
      raise exception 'Deaths, culls, and sales cannot exceed chicks received';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_farm_id uuid;
  current_balance numeric;
  excluded_movement_id uuid;
begin
  if tg_op = 'UPDATE' then
    excluded_movement_id := old.id;
  end if;

  select farm_id into item_farm_id
    from public.inventory_items
    where id = new.item_id and farm_id = new.farm_id
    for update;
  if item_farm_id is null then
    raise exception 'Inventory item not found for farm';
  end if;

  select coalesce(sum(received - used), 0)
    into current_balance
    from public.stock_movements
    where item_id = new.item_id
      and farm_id = new.farm_id
      and (excluded_movement_id is null or id <> excluded_movement_id);

  if current_balance + new.received - new.used < 0 then
    raise exception 'Stock use cannot exceed available inventory';
  end if;
  return new;
end;
$$;

create function public.validate_operational_batch_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
  batch_placed date;
  activity_date date;
begin
  target_batch_id := new.batch_id;
  if target_batch_id is null then
    return new;
  end if;

  activity_date := coalesce(
    nullif(to_jsonb(new) ->> 'record_date', '')::date,
    nullif(to_jsonb(new) ->> 'observation_date', '')::date,
    nullif(to_jsonb(new) ->> 'activity_date', '')::date,
    nullif(to_jsonb(new) ->> 'usage_date', '')::date
  );
  if activity_date is null then
    raise exception 'Operational record date is required';
  end if;

  select date_placed into batch_placed
    from public.batches
    where id = target_batch_id and farm_id = new.farm_id
    for update;
  if batch_placed is null then
    raise exception 'Batch not found for farm';
  end if;
  if activity_date < batch_placed then
    raise exception 'Record date cannot be before batch placement';
  end if;
  return new;
end;
$$;

create function public.validate_treatment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_sale_date date;
begin
  if new.record_type = 'Treatment' and new.withdrawal_days is not null then
    safe_sale_date := new.record_date + coalesce(new.duration_days, 0) + new.withdrawal_days;
    if exists (
      select 1
      from public.sales
      where farm_id = new.farm_id
        and batch_id = new.batch_id
        and sale_date < safe_sale_date
    ) then
      raise exception 'Treatment change would make an existing sale violate the withdrawal period (%)', safe_sale_date;
    end if;
  end if;
  return new;
end;
$$;

create trigger health_records_treatment_update_guard
before update on public.health_records
for each row execute function public.validate_treatment_update();

do $$
declare
  table_name text;
  insert_roles public.farm_role[];
begin
  foreach table_name in array array[
    'brooding_observations', 'biosecurity_visits', 'house_activity_records',
    'labour_records', 'utility_usage', 'maintenance_records', 'compliance_records'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_farm_member(farm_id))',
      table_name || '_member_read', table_name
    );

    insert_roles := case table_name
      when 'brooding_observations' then array['owner', 'manager', 'attendant']::public.farm_role[]
      when 'biosecurity_visits' then array['owner', 'manager', 'attendant']::public.farm_role[]
      when 'house_activity_records' then array['owner', 'manager', 'attendant']::public.farm_role[]
      when 'labour_records' then array['owner', 'manager', 'accountant']::public.farm_role[]
      when 'utility_usage' then array['owner', 'manager', 'attendant']::public.farm_role[]
      else array['owner', 'manager']::public.farm_role[]
    end;

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_farm_role(farm_id, %L::public.farm_role[]))',
      table_name || '_authorized_insert', table_name, insert_roles::text
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[])) with check (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[]))',
      table_name || '_manager_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[]))',
      table_name || '_manager_delete', table_name
    );
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_event()',
      table_name, table_name
    );
  end loop;

  foreach table_name in array array[
    'brooding_observations', 'house_activity_records', 'labour_records',
    'utility_usage', 'maintenance_records'
  ] loop
    execute format(
      'create trigger %I_closed_insert_guard before insert on public.%I for each row execute function public.prevent_closed_batch_insert()',
      table_name, table_name
    );
    execute format(
      'create trigger %I_closed_guard before update or delete on public.%I for each row execute function public.prevent_closed_batch_mutation()',
      table_name, table_name
    );
    execute format(
      'create trigger %I_validate_batch before insert or update on public.%I for each row execute function public.validate_operational_batch_date()',
      table_name, table_name
    );
  end loop;
end;
$$;

grant select, insert, update, delete on public.brooding_observations,
  public.biosecurity_visits, public.house_activity_records, public.labour_records,
  public.utility_usage, public.maintenance_records, public.compliance_records
to authenticated;
revoke all on public.brooding_observations, public.biosecurity_visits,
  public.house_activity_records, public.labour_records, public.utility_usage,
  public.maintenance_records, public.compliance_records
from anon;

notify pgrst, 'reload schema';
