create extension if not exists pgcrypto;

create type public.farm_role as enum ('owner', 'manager', 'attendant', 'accountant', 'veterinarian');
create type public.batch_type as enum ('Broiler', 'Kienyeji');
create type public.health_record_type as enum ('Vaccination', 'Treatment', 'Post-mortem');
create type public.sale_price_basis as enum ('Bird', 'Kg');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency char(3) not null default 'KES' check (currency = 'KES'),
  timezone text not null default 'Africa/Nairobi',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.farm_memberships (
  farm_id uuid not null references public.farms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.farm_role not null,
  created_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create function public.is_farm_member(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_memberships membership
    where membership.farm_id = target_farm_id
      and membership.user_id = (select auth.uid())
  );
$$;

create function public.has_farm_role(target_farm_id uuid, allowed_roles public.farm_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_memberships membership
    where membership.farm_id = target_farm_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (allowed_roles)
  );
$$;

create function public.create_farm(farm_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_farm_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if length(trim(farm_name)) = 0 then
    raise exception 'Farm name is required';
  end if;

  insert into public.farms (name, created_by)
  values (trim(farm_name), auth.uid())
  returning id into new_farm_id;

  insert into public.farm_memberships (farm_id, user_id, role)
  values (new_farm_id, auth.uid(), 'owner');

  return new_farm_id;
end;
$$;

create function public.protect_last_farm_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  other_owner_count integer;
begin
  if tg_op = 'UPDATE' and (new.farm_id <> old.farm_id or new.user_id <> old.user_id) then
    raise exception 'Farm membership identity is immutable';
  end if;
  if old.role <> 'owner'
    or (tg_op = 'UPDATE' and new.role = 'owner') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform 1 from public.farms where id = old.farm_id for update;
  select count(*) into other_owner_count
    from public.farm_memberships
    where farm_id = old.farm_id and role = 'owner' and user_id <> old.user_id;
  if other_owner_count = 0 then
    raise exception 'A farm must retain at least one owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger farm_memberships_owner_guard
before update of role, farm_id, user_id or delete on public.farm_memberships
for each row execute function public.protect_last_farm_owner();

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_code text not null,
  batch_type public.batch_type not null,
  rearing_system text,
  house text,
  date_placed date not null,
  source text,
  strain text,
  chicks_ordered integer not null default 0 check (chicks_ordered >= 0),
  chicks_received integer not null check (chicks_received > 0),
  date_sold_out date,
  status text not null default 'running' check (status in ('running', 'closed')),
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, batch_code),
  unique (farm_id, id),
  check (date_sold_out is null or date_sold_out >= date_placed),
  check ((status = 'running' and date_sold_out is null) or (status = 'closed' and date_sold_out is not null))
);

create table public.daily_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid not null,
  record_date date not null,
  dead integer not null default 0 check (dead >= 0),
  culled integer not null default 0 check (culled >= 0),
  feed_given_kg numeric(12, 3) not null default 0 check (feed_given_kg >= 0),
  feed_left_kg numeric(12, 3) not null default 0 check (feed_left_kg >= 0),
  water_liters numeric(12, 3) not null default 0 check (water_liters >= 0),
  temp_min_c numeric(5, 1),
  temp_max_c numeric(5, 1),
  litter text,
  remarks text,
  initials text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete cascade,
  unique (batch_id, record_date),
  check (feed_left_kg <= feed_given_kg),
  check (temp_min_c is null or temp_max_c is null or temp_min_c <= temp_max_c)
);

create table public.weight_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid not null,
  record_date date not null,
  age_days integer not null check (age_days >= 0),
  birds_weighed integer not null check (birds_weighed > 0),
  total_weight_g numeric(12, 2) not null check (total_weight_g > 0),
  lightest_g numeric(12, 2),
  heaviest_g numeric(12, 2),
  target_g numeric(12, 2),
  uniform_count integer check (uniform_count >= 0 and uniform_count <= birds_weighed),
  initials text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete cascade,
  check (lightest_g is null or lightest_g <= total_weight_g / birds_weighed),
  check (heaviest_g is null or heaviest_g >= total_weight_g / birds_weighed)
);

create table public.feed_deliveries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid,
  delivery_date date not null,
  feed_type text not null,
  bags integer not null check (bags > 0),
  kg_per_bag numeric(8, 2) not null check (kg_per_bag > 0),
  price_per_bag numeric(12, 2) not null check (price_per_bag >= 0),
  invoice_number text,
  supplier text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id)
);

create table public.health_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid not null,
  record_date date not null,
  record_type public.health_record_type not null,
  disease_reason text,
  product_name text,
  product_details text,
  dose_route text,
  birds_affected integer check (birds_affected >= 0),
  duration_days integer check (duration_days >= 0),
  withdrawal_days integer check (withdrawal_days >= 0),
  cost_kes numeric(12, 2) not null default 0 check (cost_kes >= 0),
  given_by text,
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete cascade,
  check (record_type <> 'Treatment' or withdrawal_days is not null)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid not null,
  sale_date date not null,
  customer text not null,
  birds_sold integer not null check (birds_sold > 0),
  total_weight_kg numeric(12, 3) not null check (total_weight_kg > 0),
  price_basis public.sale_price_basis not null,
  price_kes numeric(12, 2) not null check (price_kes >= 0),
  amount_kes numeric(12, 2) generated always as (
    case when price_basis = 'Kg' then total_weight_kg * price_kes
         else birds_sold * price_kes end
  ) stored,
  paid_kes numeric(12, 2) not null default 0 check (paid_kes >= 0),
  receipt_number text,
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete restrict,
  check (paid_kes <= amount_kes)
);

create table public.cash_entries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  entry_date date not null,
  details text not null,
  category text not null,
  batch_id uuid,
  receipt_number text,
  money_in_kes numeric(12, 2) not null default 0 check (money_in_kes >= 0),
  money_out_kes numeric(12, 2) not null default 0 check (money_out_kes >= 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id),
  check ((money_in_kes = 0) <> (money_out_kes = 0))
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null,
  item_type text not null,
  unit text not null,
  reorder_level numeric(12, 3) not null default 0 check (reorder_level >= 0),
  expiry_date date,
  created_at timestamptz not null default now(),
  unique (farm_id, name),
  unique (farm_id, id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  item_id uuid not null,
  batch_id uuid,
  movement_date date not null,
  received numeric(12, 3) not null default 0 check (received >= 0),
  used numeric(12, 3) not null default 0 check (used >= 0),
  supplier text,
  invoice_number text,
  expiry_date date,
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, item_id) references public.inventory_items(farm_id, id) on delete restrict,
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete set null (batch_id),
  check ((received = 0) <> (used = 0))
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null,
  date_purchased date not null,
  cost_kes numeric(12, 2) not null check (cost_kes >= 0),
  useful_life_years numeric(6, 2) not null check (useful_life_years > 0),
  salvage_value_kes numeric(12, 2) not null default 0 check (salvage_value_kes >= 0),
  remarks text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (salvage_value_kes <= cost_kes)
);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  batch_id uuid not null,
  source_table text not null check (source_table in ('daily_records', 'sales')),
  source_record_id uuid,
  reason text not null check (length(trim(reason)) > 0),
  dead_delta integer not null default 0,
  culled_delta integer not null default 0,
  birds_sold_delta integer not null default 0,
  live_weight_sold_kg_delta numeric(12, 3) not null default 0,
  feed_consumed_kg_delta numeric(12, 3) not null default 0,
  revenue_kes_delta numeric(12, 2) not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete restrict,
  check (dead_delta <> 0 or culled_delta <> 0 or birds_sold_delta <> 0
    or live_weight_sold_kg_delta <> 0 or feed_consumed_kg_delta <> 0
    or revenue_kes_delta <> 0)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  farm_id uuid not null references public.farms(id) on delete cascade,
  actor_id uuid default auth.uid() references auth.users(id) on delete set null,
  table_name text not null,
  record_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create function public.prevent_closed_batch_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_batch_id uuid;
  batch_status text;
begin
  target_batch_id := case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
  select status into batch_status from public.batches where id = target_batch_id;
  if batch_status = 'closed' then
    raise exception 'Records for a closed batch are immutable; create a correction entry';
  end if;
  if tg_op = 'UPDATE' and old.batch_id is distinct from new.batch_id then
    select status into batch_status from public.batches where id = old.batch_id;
    if batch_status = 'closed' then
      raise exception 'Records for a closed batch are immutable; create a correction entry';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function public.prevent_closed_batch_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  batch_status text;
begin
  if new.batch_id is not null then
    select status into batch_status from public.batches where id = new.batch_id;
    if batch_status = 'closed' then
      raise exception 'Records for a closed batch are immutable; create a correction entry';
    end if;
  end if;
  return new;
end;
$$;

create function public.validate_batch_activity()
returns trigger
language plpgsql
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

create function public.validate_stock_movement()
returns trigger
language plpgsql
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

create function public.validate_sale_withdrawal_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  safe_sale_date date;
begin
  select max(record_date + coalesce(duration_days, 0) + withdrawal_days)
    into safe_sale_date
    from public.health_records
    where farm_id = new.farm_id
      and batch_id = new.batch_id
      and record_type = 'Treatment'
      and withdrawal_days is not null;

  if safe_sale_date is not null and new.sale_date < safe_sale_date then
    raise exception 'Sale date is before the treatment withdrawal period ends (%)', safe_sale_date;
  end if;
  return new;
end;
$$;

create function public.prevent_correction_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Correction entries are append-only';
end;
$$;

create function public.validate_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  initial_birds integer;
  batch_status text;
  original_dead integer := 0;
  original_culled integer := 0;
  original_feed numeric := 0;
  original_sold integer := 0;
  original_weight numeric := 0;
  original_revenue numeric := 0;
  net_dead numeric := 0;
  net_culled numeric := 0;
  net_feed numeric := 0;
  net_sold numeric := 0;
  net_weight numeric := 0;
  net_revenue numeric := 0;
begin
  select chicks_received, status
    into initial_birds, batch_status
    from public.batches
    where id = new.batch_id and farm_id = new.farm_id
    for update;

  if initial_birds is null then
    raise exception 'Batch not found for farm';
  end if;
  if batch_status <> 'closed' then
    raise exception 'Correction entries are only for closed batches';
  end if;

  if new.source_table = 'daily_records' then
    if new.source_record_id is null
      or new.birds_sold_delta <> 0
      or new.live_weight_sold_kg_delta <> 0
      or new.revenue_kes_delta <> 0 then
      raise exception 'Daily-record corrections may only adjust deaths, culls, or feed';
    end if;

    select dead, culled, greatest(feed_given_kg - feed_left_kg, 0)
      into original_dead, original_culled, original_feed
      from public.daily_records
      where id = new.source_record_id and farm_id = new.farm_id and batch_id = new.batch_id;
    if not found then
      raise exception 'Source daily record not found in batch';
    end if;

    select coalesce(sum(dead_delta), 0), coalesce(sum(culled_delta), 0),
           coalesce(sum(feed_consumed_kg_delta), 0)
      into net_dead, net_culled, net_feed
      from public.corrections
      where source_table = 'daily_records' and source_record_id = new.source_record_id;
    if original_dead + net_dead + new.dead_delta < 0
      or original_culled + net_culled + new.culled_delta < 0
      or original_feed + net_feed + new.feed_consumed_kg_delta < 0 then
      raise exception 'Correction would make a record total negative';
    end if;
  elsif new.source_record_id is not null then
    if new.dead_delta <> 0 or new.culled_delta <> 0 or new.feed_consumed_kg_delta <> 0 then
      raise exception 'Sale corrections may only adjust sale quantities, weight, or revenue';
    end if;
    select birds_sold, total_weight_kg, amount_kes
      into original_sold, original_weight, original_revenue
      from public.sales
      where id = new.source_record_id and farm_id = new.farm_id and batch_id = new.batch_id;
    if not found then
      raise exception 'Source sale not found in batch';
    end if;

    select coalesce(sum(birds_sold_delta), 0), coalesce(sum(live_weight_sold_kg_delta), 0),
           coalesce(sum(revenue_kes_delta), 0)
      into net_sold, net_weight, net_revenue
      from public.corrections
      where source_table = 'sales' and source_record_id = new.source_record_id;
    if original_sold + net_sold + new.birds_sold_delta < 0
      or original_weight + net_weight + new.live_weight_sold_kg_delta < 0
      or original_revenue + net_revenue + new.revenue_kes_delta < 0 then
      raise exception 'Correction would make a sale total negative';
    end if;
  elsif new.source_table <> 'sales'
    or new.birds_sold_delta <= 0
    or new.live_weight_sold_kg_delta < 0
    or new.revenue_kes_delta < 0
    or new.dead_delta <> 0
    or new.culled_delta <> 0
    or new.feed_consumed_kg_delta <> 0 then
    raise exception 'New sale corrections require positive bird count and non-negative weight and revenue';
  end if;

  select coalesce(sum(dead + culled), 0) into net_dead
    from public.daily_records where batch_id = new.batch_id;
  select coalesce(sum(birds_sold), 0) into net_sold
    from public.sales where batch_id = new.batch_id;
  select coalesce(sum(dead_delta + culled_delta), 0) into original_dead
    from public.corrections where batch_id = new.batch_id;
  select coalesce(sum(birds_sold_delta), 0) into original_sold
    from public.corrections where batch_id = new.batch_id;

  if net_dead + net_sold + original_dead + original_sold
      + new.dead_delta + new.culled_delta + new.birds_sold_delta > initial_birds then
    raise exception 'Corrected deaths, culls, and sales cannot exceed chicks received';
  end if;
  return new;
end;
$$;

create function public.prevent_closed_batch_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest_activity_date date;
begin
  if old.status = 'closed' then
    raise exception 'Closed batches are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.status = 'closed' then
    select greatest(
      new.date_placed,
      coalesce((select max(record_date) from public.daily_records where batch_id = new.id), new.date_placed),
      coalesce((select max(record_date) from public.weight_records where batch_id = new.id), new.date_placed),
      coalesce((select max(delivery_date) from public.feed_deliveries where batch_id = new.id), new.date_placed),
      coalesce((select max(record_date) from public.health_records where batch_id = new.id), new.date_placed),
      coalesce((select max(sale_date) from public.sales where batch_id = new.id), new.date_placed),
      coalesce((select max(entry_date) from public.cash_entries where batch_id = new.id), new.date_placed),
      coalesce((select max(movement_date) from public.stock_movements where batch_id = new.id), new.date_placed)
    )
    into latest_activity_date;
    if new.date_sold_out < latest_activity_date then
      raise exception 'Close date cannot be before the batch activity date (%)', latest_activity_date;
    end if;
  end if;
  return new;
end;
$$;

create function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_farm_id uuid;
  record_id uuid;
begin
  record_farm_id := case when tg_op = 'DELETE' then old.farm_id else new.farm_id end;
  record_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.audit_events (farm_id, table_name, record_id, operation, old_data, new_data)
  values (
    record_farm_id,
    tg_table_name,
    record_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function public.write_membership_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_farm_id uuid;
  membership_user_id uuid;
begin
  membership_farm_id := case when tg_op = 'DELETE' then old.farm_id else new.farm_id end;
  membership_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  insert into public.audit_events (farm_id, table_name, record_id, operation, old_data, new_data)
  values (
    membership_farm_id,
    tg_table_name,
    membership_user_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger farm_memberships_audit
after insert or update or delete on public.farm_memberships
for each row execute function public.write_membership_audit_event();

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger batches_updated_at before update on public.batches
for each row execute function public.set_updated_at();
create trigger daily_records_updated_at before update on public.daily_records
for each row execute function public.set_updated_at();
create trigger weight_records_updated_at before update on public.weight_records
for each row execute function public.set_updated_at();
create trigger batches_closed_guard before update or delete on public.batches
for each row execute function public.prevent_closed_batch_row_mutation();
create trigger corrections_append_only before update or delete on public.corrections
for each row execute function public.prevent_correction_mutation();
create trigger corrections_validate before insert on public.corrections
for each row execute function public.validate_correction();
create trigger sales_withdrawal_guard before insert or update on public.sales
for each row execute function public.validate_sale_withdrawal_period();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['daily_records', 'weight_records', 'feed_deliveries', 'health_records', 'sales', 'cash_entries', 'stock_movements'] loop
    execute format('create trigger %I_closed_insert_guard before insert on public.%I for each row execute function public.prevent_closed_batch_insert()', table_name, table_name);
    execute format('create trigger %I_closed_guard before update or delete on public.%I for each row execute function public.prevent_closed_batch_mutation()', table_name, table_name);
    execute format('create trigger %I_validate_batch before insert or update on public.%I for each row execute function public.validate_batch_activity()', table_name, table_name);
  end loop;
  execute 'create trigger stock_movements_validate before insert or update on public.stock_movements for each row execute function public.validate_stock_movement()';
  foreach table_name in array array['batches', 'daily_records', 'weight_records', 'feed_deliveries', 'health_records', 'sales', 'cash_entries', 'stock_movements', 'assets', 'corrections'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_event()', table_name, table_name);
  end loop;
end;
$$;

create view public.batch_performance
with (security_invoker = true)
as
with daily_totals as (
  select farm_id, batch_id,
         sum(dead)::bigint as dead,
         sum(culled)::bigint as culled,
         sum(greatest(feed_given_kg - feed_left_kg, 0)) as feed_consumed_kg
  from public.daily_records
  group by farm_id, batch_id
),
sale_totals as (
  select farm_id, batch_id,
         sum(birds_sold)::bigint as birds_sold,
         sum(total_weight_kg) as live_weight_sold_kg,
         sum(amount_kes) as revenue_kes,
         sum(paid_kes) as paid_kes
  from public.sales
  group by farm_id, batch_id
),
cash_totals as (
  select farm_id, batch_id, sum(money_out_kes) as total_cost_kes
  from public.cash_entries
  where batch_id is not null
  group by farm_id, batch_id
),
correction_totals as (
  select farm_id, batch_id,
         sum(dead_delta)::bigint as dead_delta,
         sum(culled_delta)::bigint as culled_delta,
         sum(birds_sold_delta)::bigint as birds_sold_delta,
         sum(live_weight_sold_kg_delta) as live_weight_sold_kg_delta,
         sum(feed_consumed_kg_delta) as feed_consumed_kg_delta,
         sum(revenue_kes_delta) as revenue_kes_delta
  from public.corrections
  group by farm_id, batch_id
),
latest_weight as (
  select distinct on (farm_id, batch_id)
         farm_id, batch_id, total_weight_g / birds_weighed / 1000 as avg_weight_kg
  from public.weight_records
  order by farm_id, batch_id, record_date desc, created_at desc
)
select b.farm_id, b.id as batch_id, b.batch_code, b.batch_type, b.status,
       b.date_placed, b.date_sold_out, b.chicks_received,
       coalesce(d.dead, 0) + coalesce(c.dead_delta, 0) as dead,
       coalesce(d.culled, 0) + coalesce(c.culled_delta, 0) as culled,
       coalesce(s.birds_sold, 0) + coalesce(c.birds_sold_delta, 0) as birds_sold,
       coalesce(s.live_weight_sold_kg, 0) + coalesce(c.live_weight_sold_kg_delta, 0) as live_weight_sold_kg,
       coalesce(d.feed_consumed_kg, 0) + coalesce(c.feed_consumed_kg_delta, 0) as feed_consumed_kg,
       coalesce(s.revenue_kes, 0) + coalesce(c.revenue_kes_delta, 0) as revenue_kes,
       coalesce(s.paid_kes, 0) as paid_kes,
       coalesce(s.revenue_kes, 0) + coalesce(c.revenue_kes_delta, 0)
         - coalesce(s.paid_kes, 0) as outstanding_kes,
       coalesce(ca.total_cost_kes, 0) as total_cost_kes,
       coalesce(s.revenue_kes, 0) + coalesce(c.revenue_kes_delta, 0)
         - coalesce(ca.total_cost_kes, 0) as profit_kes,
       case when b.status = 'closed' then
         case when coalesce(s.live_weight_sold_kg, 0) + coalesce(c.live_weight_sold_kg_delta, 0) > 0
           then (coalesce(d.feed_consumed_kg, 0) + coalesce(c.feed_consumed_kg_delta, 0))
             / (coalesce(s.live_weight_sold_kg, 0) + coalesce(c.live_weight_sold_kg_delta, 0)) end
         else
           case when coalesce(s.live_weight_sold_kg, 0) + coalesce(c.live_weight_sold_kg_delta, 0)
             + greatest(b.chicks_received - coalesce(d.dead, 0) - coalesce(d.culled, 0)
                 - coalesce(c.dead_delta, 0) - coalesce(c.culled_delta, 0)
                 - coalesce(s.birds_sold, 0) - coalesce(c.birds_sold_delta, 0), 0)
               * coalesce(w.avg_weight_kg, 0) > 0
             and (
               greatest(b.chicks_received - coalesce(d.dead, 0) - coalesce(d.culled, 0)
                   - coalesce(c.dead_delta, 0) - coalesce(c.culled_delta, 0)
                   - coalesce(s.birds_sold, 0) - coalesce(c.birds_sold_delta, 0), 0) = 0
               or w.avg_weight_kg is not null
             )
           then (coalesce(d.feed_consumed_kg, 0) + coalesce(c.feed_consumed_kg_delta, 0)) / (
             coalesce(s.live_weight_sold_kg, 0) + coalesce(c.live_weight_sold_kg_delta, 0)
             + greatest(b.chicks_received - coalesce(d.dead, 0) - coalesce(d.culled, 0)
                 - coalesce(c.dead_delta, 0) - coalesce(c.culled_delta, 0)
                 - coalesce(s.birds_sold, 0) - coalesce(c.birds_sold_delta, 0), 0)
               * coalesce(w.avg_weight_kg, 0)
           ) end
       end as fcr
from public.batches b
left join daily_totals d on d.farm_id = b.farm_id and d.batch_id = b.id
left join sale_totals s on s.farm_id = b.farm_id and s.batch_id = b.id
left join cash_totals ca on ca.farm_id = b.farm_id and ca.batch_id = b.id
left join correction_totals c on c.farm_id = b.farm_id and c.batch_id = b.id
left join latest_weight w on w.farm_id = b.farm_id and w.batch_id = b.id;
comment on view public.batch_performance is
'FCR is feed consumed / live-weight output. Running batches include estimated live flock weight from the latest sample; closed batches use total live weight sold.';

alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.farm_memberships enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'batches', 'daily_records', 'weight_records', 'feed_deliveries',
    'health_records', 'sales', 'cash_entries', 'inventory_items',
    'stock_movements', 'assets', 'corrections', 'audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_farm_member(farm_id))',
      table_name || '_member_read', table_name
    );
    if table_name in ('batches', 'inventory_items', 'assets') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[]))',
        table_name || '_authorized_insert', table_name
      );
    elsif table_name in ('daily_records', 'weight_records', 'feed_deliveries', 'stock_movements') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_farm_role(farm_id, array[''owner'', ''manager'', ''attendant'']::public.farm_role[]))',
        table_name || '_authorized_insert', table_name
      );
    elsif table_name = 'health_records' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_farm_role(farm_id, array[''owner'', ''manager'', ''veterinarian'']::public.farm_role[]))',
        table_name || '_authorized_insert', table_name
      );
    elsif table_name in ('sales', 'cash_entries') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_farm_role(farm_id, array[''owner'', ''manager'', ''accountant'']::public.farm_role[]))',
        table_name || '_authorized_insert', table_name
      );
    elsif table_name = 'corrections' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[]))',
        table_name || '_authorized_insert', table_name
      );
    end if;
    if table_name not in ('audit_events', 'corrections') then
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[])) with check (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[]))',
        table_name || '_manager_update', table_name
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.has_farm_role(farm_id, array[''owner'', ''manager'']::public.farm_role[]))',
        table_name || '_manager_delete', table_name
      );
    end if;
  end loop;
end;
$$;

create policy "profiles_read_self" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "farms_member_read" on public.farms for select to authenticated using (public.is_farm_member(id));
create policy "farms_owner_update" on public.farms for update to authenticated using (public.has_farm_role(id, array['owner']::public.farm_role[])) with check (public.has_farm_role(id, array['owner']::public.farm_role[]));
create policy "memberships_member_read" on public.farm_memberships for select to authenticated using (public.is_farm_member(farm_id));
create policy "memberships_owner_insert" on public.farm_memberships for insert to authenticated with check (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));
create policy "memberships_owner_update" on public.farm_memberships for update to authenticated using (public.has_farm_role(farm_id, array['owner']::public.farm_role[])) with check (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));
create policy "memberships_owner_delete" on public.farm_memberships for delete to authenticated using (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));

grant usage on schema public to authenticated;
revoke all on public.profiles, public.farms, public.farm_memberships,
  public.batches, public.daily_records, public.weight_records, public.feed_deliveries,
  public.health_records, public.sales, public.cash_entries, public.inventory_items,
  public.stock_movements, public.assets, public.corrections, public.audit_events
from anon;
grant select, insert, update, delete on public.profiles, public.farms, public.farm_memberships,
  public.batches, public.daily_records, public.weight_records, public.feed_deliveries,
  public.health_records, public.sales, public.cash_entries, public.inventory_items,
  public.stock_movements, public.assets, public.corrections, public.audit_events
to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on function public.create_farm(text) from public;
grant execute on function public.create_farm(text) to authenticated;

grant select on public.batch_performance to authenticated;
revoke all on public.batch_performance from anon;

create view public.inventory_balances
with (security_invoker = true)
as
select item.farm_id, item.id as item_id, item.name, item.item_type, item.unit,
       item.reorder_level, item.expiry_date,
       coalesce(sum(movement.received), 0) as total_received,
       coalesce(sum(movement.used), 0) as total_used,
       coalesce(sum(movement.received - movement.used), 0) as balance
from public.inventory_items item
left join public.stock_movements movement
  on movement.farm_id = item.farm_id and movement.item_id = item.id
group by item.farm_id, item.id, item.name, item.item_type, item.unit,
         item.reorder_level, item.expiry_date;
comment on view public.inventory_balances is
'Stock on hand is the net sum of append-only receipts and usage movements.';
grant select on public.inventory_balances to authenticated;
revoke all on public.inventory_balances from anon;
