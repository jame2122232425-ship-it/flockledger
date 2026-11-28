insert into public.permission_catalog (permission_key, category, description) values
  ('dashboard.view', 'dashboard', 'View operational farm dashboard data.'),
  ('batches.view', 'production', 'View farm batches.'),
  ('batches.create', 'production', 'Create farm batches.'),
  ('batches.update', 'production', 'Update operational batch details.'),
  ('batches.close', 'production', 'Close a batch after validation.'),
  ('production.view', 'production', 'View production and flock records.'),
  ('production.record', 'production', 'Record production and operational activity.'),
  ('sales.view', 'sales', 'View operational sales details and sales summaries.'),
  ('inventory.view', 'inventory', 'View inventory and stock balances.'),
  ('inventory.adjust', 'inventory', 'Adjust stock movement records.'),
  ('health.view', 'health', 'View farm health records.'),
  ('health.coordinate', 'health', 'Report and coordinate non-clinical health incidents.'),
  ('staff.view', 'staff', 'View farm team membership.'),
  ('staff.invite', 'staff', 'Invite eligible non-manager farm employees.'),
  ('staff.assign_roles', 'staff', 'Assign only eligible non-owner, non-manager employee roles.'),
  ('staff.deactivate', 'staff', 'Deactivate farm employee membership.'),
  ('reports.view', 'reports', 'View authorized operational reports.'),
  ('reports.export', 'reports', 'Export authorized operational reports.')
on conflict (permission_key) do nothing;

insert into public.farm_role_permissions (role, permission_key)
select 'owner'::public.farm_role, permission_key
from public.permission_catalog
on conflict do nothing;

delete from public.farm_role_permissions
where role = 'manager'
  and permission_key in (
    'finance.view',
    'audit.view.full',
    'audit.view.operational',
    'audit.view.financial',
    'audit.view.inventory'
  );

insert into public.farm_role_permissions (role, permission_key)
values
  ('manager', 'dashboard.view'),
  ('manager', 'batches.view'),
  ('manager', 'batches.create'),
  ('manager', 'batches.update'),
  ('manager', 'batches.close'),
  ('manager', 'production.view'),
  ('manager', 'production.record'),
  ('manager', 'sales.view'),
  ('manager', 'finance.sales.create'),
  ('manager', 'finance.corrections.initiate'),
  ('manager', 'inventory.view'),
  ('manager', 'inventory.manage'),
  ('manager', 'health.view'),
  ('manager', 'health.coordinate'),
  ('manager', 'staff.view'),
  ('manager', 'reports.view')
on conflict do nothing;

create table public.farm_permission_delegations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  grantee_user_id uuid not null references auth.users(id) on delete restrict,
  permission_key text not null references public.permission_catalog(permission_key) on delete restrict,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  check ((revoked_at is null) = (revoked_by is null))
);

create unique index farm_permission_delegations_active_unique
  on public.farm_permission_delegations (farm_id, grantee_user_id, permission_key)
  where revoked_at is null;
create index farm_permission_delegations_grantee_idx
  on public.farm_permission_delegations (farm_id, grantee_user_id)
  where revoked_at is null;

alter table public.farm_permission_delegations enable row level security;
revoke all on public.farm_permission_delegations from public, anon, authenticated;

create trigger farm_permission_delegations_audit
after insert or update on public.farm_permission_delegations
for each row execute function public.write_audit_event();

create or replace function public.has_farm_permission(
  target_farm_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_memberships membership
    join public.farms farm on farm.id = membership.farm_id
    where membership.farm_id = target_farm_id
      and membership.user_id = (select auth.uid())
      and (
        exists (
          select 1
          from public.farm_role_permissions permission
          where permission.role = membership.role
            and permission.permission_key = required_permission
        )
        or exists (
          select 1
          from public.farm_permission_delegations delegation
          where delegation.farm_id = membership.farm_id
            and delegation.grantee_user_id = membership.user_id
            and delegation.permission_key = required_permission
            and delegation.revoked_at is null
        )
      )
      and (
        required_permission not like 'audit.view.%'
        or membership.role = 'owner'
      )
      and (
        farm.lifecycle_status = 'active'
        or (
          farm.lifecycle_status = 'suspended'
          and required_permission in (
            'finance.view',
            'audit.view.full',
            'audit.view.operational',
            'audit.view.financial',
            'audit.view.inventory'
          )
        )
      )
  );
$$;

create function public.get_my_farm_permissions(p_farm_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  effective_permissions text[];
begin
  if auth.uid() is null or not public.is_farm_member(p_farm_id) then
    raise exception 'Farm membership required.' using errcode = '42501';
  end if;

  select coalesce(array_agg(permission_key order by permission_key), array[]::text[])
  into effective_permissions
  from (
    select permission.permission_key
    from public.farm_memberships membership
    join public.farms farm on farm.id = membership.farm_id
    join public.farm_role_permissions permission on permission.role = membership.role
    where membership.farm_id = p_farm_id
      and membership.user_id = auth.uid()
      and (
        farm.lifecycle_status = 'active'
        or (
          farm.lifecycle_status = 'suspended'
          and permission.permission_key in (
            'finance.view',
            'audit.view.full',
            'audit.view.operational',
            'audit.view.financial',
            'audit.view.inventory'
          )
        )
      )
    union
    select delegation.permission_key
    from public.farm_permission_delegations delegation
    join public.farms farm on farm.id = delegation.farm_id
    where delegation.farm_id = p_farm_id
      and delegation.grantee_user_id = auth.uid()
      and delegation.revoked_at is null
      and farm.lifecycle_status = 'active'
  ) effective
  where permission_key not like 'audit.view.%'
     or exists (
       select 1 from public.farm_memberships membership
       where membership.farm_id = p_farm_id
         and membership.user_id = auth.uid()
         and membership.role = 'owner'
     );

  return effective_permissions;
end;
$$;

create function public.get_farm_permission_delegations(p_farm_id uuid)
returns table (
  id uuid,
  user_id uuid,
  role public.farm_role,
  permission_key text,
  granted_by uuid,
  granted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can review permission delegations.' using errcode = '42501';
  end if;

  return query
  select delegation.id, delegation.grantee_user_id, membership.role,
         delegation.permission_key, delegation.granted_by, delegation.granted_at,
         delegation.revoked_by, delegation.revoked_at
  from public.farm_permission_delegations delegation
  join public.farm_memberships membership
    on membership.farm_id = delegation.farm_id
   and membership.user_id = delegation.grantee_user_id
  where delegation.farm_id = p_farm_id
  order by delegation.granted_at desc, delegation.id;
end;
$$;

create function public.replace_manager_permission_delegations(
  p_farm_id uuid,
  p_manager_user_id uuid,
  p_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_permissions constant text[] := array[
    'staff.invite', 'staff.assign_roles', 'inventory.adjust', 'reports.export'
  ];
begin
  if auth.uid() is null
    or not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can delegate permissions.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.farm_memberships
    where farm_id = p_farm_id and user_id = p_manager_user_id and role = 'manager'
  ) then
    raise exception 'Delegations can only be assigned to a farm manager.' using errcode = '22023';
  end if;
  if p_permissions is null
    or cardinality(p_permissions) <> cardinality(array(select distinct value from unnest(p_permissions) value))
    or exists (
      select 1 from unnest(p_permissions) requested(permission)
      where not (requested.permission = any(allowed_permissions))
    ) then
    raise exception 'One or more permissions cannot be delegated.' using errcode = '22023';
  end if;

  update public.farm_permission_delegations delegation
  set revoked_by = auth.uid(), revoked_at = statement_timestamp()
  where delegation.farm_id = p_farm_id
    and delegation.grantee_user_id = p_manager_user_id
    and delegation.revoked_at is null
    and not (delegation.permission_key = any(p_permissions));

  insert into public.farm_permission_delegations (
    farm_id, grantee_user_id, permission_key, granted_by
  )
  select p_farm_id, p_manager_user_id, requested.permission, auth.uid()
  from unnest(p_permissions) requested(permission)
  where not exists (
    select 1 from public.farm_permission_delegations active
    where active.farm_id = p_farm_id
      and active.grantee_user_id = p_manager_user_id
      and active.permission_key = requested.permission
      and active.revoked_at is null
  );

  return jsonb_build_object('updated', true);
end;
$$;

revoke all on function public.has_farm_permission(uuid, text) from public, anon;
revoke all on function public.get_my_farm_permissions(uuid) from public, anon;
revoke all on function public.get_farm_permission_delegations(uuid) from public, anon;
revoke all on function public.replace_manager_permission_delegations(uuid, uuid, text[]) from public, anon;
grant execute on function public.has_farm_permission(uuid, text) to authenticated;
grant execute on function public.get_my_farm_permissions(uuid) to authenticated;
grant execute on function public.get_farm_permission_delegations(uuid) to authenticated;
grant execute on function public.replace_manager_permission_delegations(uuid, uuid, text[]) to authenticated;

create function public.get_farm_staff_invitations(p_farm_id uuid)
returns table (
  id uuid,
  email text,
  role public.farm_role,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or (
      not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[])
      and not public.has_farm_permission(p_farm_id, 'staff.invite')
    ) then
    raise exception 'Staff invitation permission required.' using errcode = '42501';
  end if;

  return query
  select invitation.id, invitation.email, invitation.role,
         invitation.status, invitation.created_at
  from public.farm_invitations invitation
  where invitation.farm_id = p_farm_id
  order by invitation.created_at desc, invitation.id desc;
end;
$$;
revoke all on function public.get_farm_staff_invitations(uuid) from public, anon;
grant execute on function public.get_farm_staff_invitations(uuid) to authenticated;

drop policy if exists memberships_self_or_owner_read on public.farm_memberships;
create policy memberships_self_owner_or_staff_read on public.farm_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_farm_role(farm_id, array['owner']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'staff.view')
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'batches', 'daily_records', 'weight_records', 'feed_deliveries',
    'health_records', 'inventory_items', 'stock_movements', 'assets',
    'brooding_observations', 'biosecurity_visits', 'house_activity_records',
    'labour_records', 'utility_usage', 'maintenance_records', 'compliance_records'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_manager_delete', table_name);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_farm_role(farm_id, array[''owner'']::public.farm_role[]))',
      table_name || '_owner_delete', table_name
    );
  end loop;
end;
$$;

drop policy if exists batches_authorized_insert on public.batches;
create policy batches_authorized_insert on public.batches
for insert to authenticated
with check (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'batches.create')
);

drop policy if exists batches_manager_update on public.batches;
create policy batches_authorized_update on public.batches
for update to authenticated
using (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'batches.update')
)
with check (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'batches.update')
);

drop policy if exists health_records_authorized_insert on public.health_records;
create policy health_records_clinician_insert on public.health_records
for insert to authenticated
with check (public.has_farm_role(farm_id, array['owner', 'veterinarian']::public.farm_role[]));
drop policy if exists health_records_manager_update on public.health_records;
create policy health_records_clinician_update on public.health_records
for update to authenticated
using (public.has_farm_role(farm_id, array['owner', 'veterinarian']::public.farm_role[]))
with check (public.has_farm_role(farm_id, array['owner', 'veterinarian']::public.farm_role[]));

drop policy if exists daily_records_authorized_insert on public.daily_records;
create policy daily_records_authorized_insert on public.daily_records
for insert to authenticated
with check (
  public.has_farm_role(farm_id, array['owner', 'attendant']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'production.record')
);
drop policy if exists weight_records_authorized_insert on public.weight_records;
create policy weight_records_authorized_insert on public.weight_records
for insert to authenticated
with check (
  public.has_farm_role(farm_id, array['owner', 'attendant']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'production.record')
);
drop policy if exists feed_deliveries_authorized_insert on public.feed_deliveries;
create policy feed_deliveries_authorized_insert on public.feed_deliveries
for insert to authenticated
with check (
  public.has_farm_role(farm_id, array['owner', 'attendant']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'production.record')
);

drop policy if exists inventory_items_authorized_insert on public.inventory_items;
create policy inventory_items_authorized_insert on public.inventory_items
for insert to authenticated
with check (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'inventory.manage')
);
drop policy if exists stock_movements_authorized_insert on public.stock_movements;
create policy stock_movements_authorized_insert on public.stock_movements
for insert to authenticated
with check (
  public.has_farm_role(farm_id, array['owner', 'attendant']::public.farm_role[])
  or public.has_farm_permission(farm_id, 'inventory.manage')
);

do $$
declare
  table_name text;
  required_permission text;
begin
  foreach table_name in array array[
    'daily_records', 'weight_records', 'feed_deliveries', 'inventory_items',
    'stock_movements', 'assets', 'brooding_observations', 'biosecurity_visits',
    'house_activity_records', 'labour_records', 'utility_usage',
    'maintenance_records', 'compliance_records'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_manager_update', table_name);
    required_permission := case
      when table_name = 'inventory_items' then 'inventory.manage'
      when table_name = 'stock_movements' then 'inventory.adjust'
      when table_name = 'biosecurity_visits' then 'health.coordinate'
      else 'production.record'
    end;
    if table_name = 'assets' then
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.has_farm_role(farm_id, array[''owner'']::public.farm_role[])) with check (public.has_farm_role(farm_id, array[''owner'']::public.farm_role[]))',
        table_name || '_owner_update', table_name
      );
    else
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.has_farm_role(farm_id, array[''owner'']::public.farm_role[]) or public.has_farm_permission(farm_id, %L)) with check (public.has_farm_role(farm_id, array[''owner'']::public.farm_role[]) or public.has_farm_permission(farm_id, %L))',
        table_name || '_permission_update', table_name, required_permission, required_permission
      );
    end if;
  end loop;
end;
$$;

drop policy if exists assets_member_read on public.assets;
create policy assets_finance_read on public.assets
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));
drop policy if exists assets_authorized_insert on public.assets;
create policy assets_owner_insert on public.assets
for insert to authenticated
with check (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));

create table public.health_incidents (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  batch_id uuid,
  incident_date date not null,
  summary text not null check (length(trim(summary)) between 1 and 255),
  observed_signs text not null check (length(trim(observed_signs)) between 1 and 4000),
  birds_affected integer not null check (birds_affected >= 0),
  immediate_actions text check (immediate_actions is null or length(immediate_actions) <= 4000),
  reported_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete restrict
);
alter table public.health_incidents enable row level security;
create policy health_incidents_member_read on public.health_incidents
for select to authenticated
using (public.has_farm_permission(farm_id, 'health.view'));
create policy health_incidents_authorized_insert on public.health_incidents
for insert to authenticated
with check (
  reported_by = (select auth.uid())
  and public.has_farm_permission(farm_id, 'health.coordinate')
);
create trigger health_incidents_audit
after insert on public.health_incidents
for each row execute function public.write_audit_event();
revoke all on public.health_incidents from public, anon, authenticated;
grant select, insert on public.health_incidents to authenticated;

create index health_incidents_farm_date_idx
  on public.health_incidents (farm_id, incident_date desc, id desc);

create function public.get_operational_sales_page(
  p_farm_id uuid,
  p_batch_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_cursor_date date default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id text default null,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null
    or not public.has_farm_permission(p_farm_id, 'sales.view') then
    raise exception 'Sales view permission required.' using errcode = '42501';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Page size must be between 1 and 100.' using errcode = '22023';
  end if;
  if (p_cursor_date is null) <> (p_cursor_created_at is null)
    or (p_cursor_date is null) <> (p_cursor_id is null) then
    raise exception 'A complete sales cursor is required.' using errcode = '22023';
  end if;

  with filtered_sales as materialized (
    select sale.id, sale.farm_id, sale.batch_id, sale.sale_date, sale.customer,
           sale.birds_sold, sale.total_weight_kg, sale.receipt_number,
           sale.remarks, sale.created_at
    from public.sales sale
    where sale.farm_id = p_farm_id
      and (p_batch_id is null or sale.batch_id = p_batch_id)
      and (p_from is null or sale.sale_date >= p_from)
      and (p_to is null or sale.sale_date <= p_to)
      and (
        nullif(btrim(p_search), '') is null
        or sale.customer ilike '%' || replace(
          replace(btrim(p_search), '%', chr(92) || '%'),
          '_', chr(92) || '_'
        ) || '%' escape chr(92)
      )
  ),
  matching_sales as materialized (
    select * from filtered_sales
    where p_cursor_date is null or p_cursor_created_at is null or p_cursor_id is null
      or (sale_date, created_at, id::text) < (p_cursor_date, p_cursor_created_at, p_cursor_id)
  ),
  page_rows as materialized (
    select * from matching_sales
    order by sale_date desc, created_at desc, id::text desc
    limit p_page_size + 1
  ),
  visible_rows as materialized (
    select * from page_rows
    order by sale_date desc, created_at desc, id::text desc
    limit p_page_size
  ),
  totals as (
    select count(*)::integer as sale_count
    from filtered_sales
  ),
  last_visible as (
    select sale_date, created_at, id
    from visible_rows
    order by sale_date asc, created_at asc, id::text asc
    limit 1
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sale.id::text,
        'farm_id', sale.farm_id,
        'batch_id', sale.batch_id,
        'sale_date', sale.sale_date,
        'customer', sale.customer,
        'birds_sold', sale.birds_sold,
        'total_weight_kg', sale.total_weight_kg,
        'price_basis', null,
        'price_kes', null,
        'amount_kes', 0,
        'paid_kes', 0,
        'unreconciled_paid_kes', 0,
        'outstanding_kes', 0,
        'payment_status', 'unpaid',
        'receipt_number', sale.receipt_number,
        'remarks', sale.remarks,
        'created_at', sale.created_at,
        'is_adjustment', false
      ) order by sale.sale_date desc, sale.created_at desc, sale.id::text desc)
      from visible_rows sale
    ), '[]'::jsonb),
    'summary', (select jsonb_build_object(
      'sales_kes', 0,
      'received_kes', 0,
      'outstanding_kes', 0,
      'unreconciled_paid_kes', 0,
      'sale_count', totals.sale_count
    ) from totals),
    'hasMore', (select count(*) > p_page_size from page_rows),
    'nextCursor', case
      when (select count(*) > p_page_size from page_rows)
        then (select jsonb_build_object(
          'saleDate', last_visible.sale_date,
          'createdAt', last_visible.created_at,
          'id', last_visible.id::text
        ) from last_visible)
      else null
    end
  ) into result;

  return result;
end;
$$;
revoke all on function public.get_operational_sales_page(
  uuid, uuid, date, date, text, date, timestamptz, text, integer
) from public, anon;
grant execute on function public.get_operational_sales_page(
  uuid, uuid, date, date, text, date, timestamptz, text, integer
) to authenticated;

create or replace function public.create_batch_with_quota(
  p_farm_id uuid,
  p_batch_code text,
  p_batch_type public.batch_type,
  p_rearing_system text,
  p_house text,
  p_date_placed date,
  p_source text,
  p_strain text,
  p_chicks_ordered integer,
  p_chicks_received integer,
  p_remarks text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_feature jsonb;
  active_batch_count bigint;
  batch_row public.batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;
  if not public.has_farm_permission(p_farm_id, 'batches.create') then
    raise exception 'You cannot create batches for this farm.' using errcode = '42501';
  end if;

  quota_feature := public.get_farm_quota_feature(p_farm_id, 'max_active_batches');
  if quota_feature ->> 'configured' <> 'true' then
    raise exception 'The active batch limit is not configured.' using errcode = '55000';
  end if;
  if quota_feature ->> 'enabled' <> 'true' then
    raise exception 'Batch creation is not enabled for this plan.' using errcode = '55000';
  end if;
  select count(*) into active_batch_count
  from public.batches
  where farm_id = p_farm_id and status = 'running';
  if quota_feature -> 'limit' <> 'null'::jsonb
    and active_batch_count >= (quota_feature ->> 'limit')::bigint then
    raise exception 'ACTIVE_BATCH_QUOTA_EXCEEDED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'usage', active_batch_count,
              'limit', (quota_feature ->> 'limit')::bigint
            )::text;
  end if;

  insert into public.batches (
    farm_id, batch_code, batch_type, rearing_system, house, date_placed,
    source, strain, chicks_ordered, chicks_received, remarks, created_by
  ) values (
    p_farm_id, p_batch_code, p_batch_type, p_rearing_system, p_house, p_date_placed,
    p_source, p_strain, p_chicks_ordered, p_chicks_received, p_remarks, auth.uid()
  )
  returning * into batch_row;

  return to_jsonb(batch_row) - 'created_by' - 'updated_at';
end;
$$;

revoke all on function public.create_batch_with_quota(
  uuid, text, public.batch_type, text, text, date, text, text, integer, integer, text
) from public, anon;
grant execute on function public.create_batch_with_quota(
  uuid, text, public.batch_type, text, text, date, text, text, integer, integer, text
) to authenticated;

create or replace function public.update_farm_member_role(
  p_farm_id uuid,
  p_user_id uuid,
  p_role public.farm_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_membership public.farm_memberships%rowtype;
  updated_membership public.farm_memberships%rowtype;
  quota_feature jsonb;
  occupied_seats bigint;
  is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  is_owner := public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]);
  if not is_owner and not (
    public.has_farm_permission(p_farm_id, 'staff.assign_roles')
    and p_user_id <> auth.uid()
    and p_role not in ('owner', 'manager')
  ) then
    raise exception 'You cannot change member roles for this farm.' using errcode = '42501';
  end if;

  select * into current_membership
  from public.farm_memberships
  where farm_id = p_farm_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'Farm member not found.' using errcode = 'P0002';
  end if;
  if not is_owner and current_membership.role in ('owner', 'manager') then
    raise exception 'Managers cannot change owner or manager roles.' using errcode = '42501';
  end if;
  if current_membership.role = 'owner' and p_role <> 'owner'
    and not exists (
      select 1 from public.farm_memberships
      where farm_id = p_farm_id and role = 'owner' and user_id <> p_user_id
    ) then
    raise exception 'A farm must retain at least one owner.' using errcode = '23514';
  end if;
  if current_membership.role = 'owner' and p_role <> 'owner' then
    quota_feature := public.get_farm_quota_feature(p_farm_id, 'max_staff_users');
    if quota_feature ->> 'configured' <> 'true'
      or quota_feature ->> 'enabled' <> 'true' then
      raise exception 'The additional staff limit is not configured.' using errcode = '55000';
    end if;
    occupied_seats := public.count_occupied_farm_staff_seats(p_farm_id);
    if quota_feature -> 'limit' <> 'null'::jsonb
      and occupied_seats >= (quota_feature ->> 'limit')::bigint then
      raise exception 'STAFF_SEAT_QUOTA_EXCEEDED'
        using errcode = 'P0001',
              detail = jsonb_build_object(
                'usage', occupied_seats,
                'limit', (quota_feature ->> 'limit')::bigint
              )::text;
    end if;
  end if;

  update public.farm_memberships
  set role = p_role
  where farm_id = p_farm_id and user_id = p_user_id
  returning * into updated_membership;

  if p_role <> 'manager' then
    update public.farm_permission_delegations
    set revoked_by = auth.uid(), revoked_at = statement_timestamp()
    where farm_id = p_farm_id and grantee_user_id = p_user_id and revoked_at is null;
  end if;

  return to_jsonb(updated_membership);
end;
$$;

revoke all on function public.update_farm_member_role(uuid, uuid, public.farm_role) from public, anon;
grant execute on function public.update_farm_member_role(uuid, uuid, public.farm_role) to authenticated;

create or replace function public.remove_farm_member(p_farm_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can remove members.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.farm_memberships target
    where target.farm_id = p_farm_id and target.user_id = p_user_id and target.role = 'owner'
  ) and not exists (
    select 1 from public.farm_memberships other_owner
    where other_owner.farm_id = p_farm_id and other_owner.role = 'owner'
      and other_owner.user_id <> p_user_id
  ) then
    raise exception 'A farm must retain at least one owner.' using errcode = '23514';
  end if;

  update public.farm_permission_delegations
  set revoked_by = auth.uid(), revoked_at = statement_timestamp()
  where farm_id = p_farm_id and grantee_user_id = p_user_id and revoked_at is null;
  delete from public.farm_memberships
  where farm_id = p_farm_id and user_id = p_user_id;
  if not found then
    raise exception 'Farm member not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('removed', true, 'userId', p_user_id);
end;
$$;

revoke all on function public.remove_farm_member(uuid, uuid) from public, anon;
grant execute on function public.remove_farm_member(uuid, uuid) to authenticated;

create or replace function public.reserve_farm_staff_seat(
  p_farm_id uuid,
  p_email text,
  p_role public.farm_role,
  p_full_name text,
  p_idempotency_key_hash text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.farm_staff_seat_reservations%rowtype;
  quota_feature jsonb;
  occupied_seats bigint;
  reservation public.farm_staff_seat_reservations%rowtype;
  normalized_email text := lower(trim(p_email));
  is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_role = 'owner' or normalized_email = '' then
    raise exception 'A valid staff email and non-owner role are required.' using errcode = '22023';
  end if;
  if length(p_idempotency_key_hash) <> 64 or length(p_payload_hash) <> 64 then
    raise exception 'A valid idempotency key and payload hash are required.' using errcode = '22023';
  end if;
  is_owner := public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]);
  if not is_owner and p_role = 'manager' then
    raise exception 'Managers cannot invite another manager.' using errcode = '42501';
  end if;
  if not public.has_farm_permission(p_farm_id, 'staff.invite') then
    raise exception 'Staff invitation permission required.' using errcode = '42501';
  end if;
  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  update public.farm_staff_seat_reservations
  set status = 'released'
  where farm_id = p_farm_id
    and status in ('reserved', 'provisioned')
    and expires_at <= statement_timestamp();
  update public.farm_invitations invitation
  set status = 'cancelled', setup_token_hash = null
  where invitation.farm_id = p_farm_id
    and invitation.reservation_id in (
      select expired_reservation.id
      from public.farm_staff_seat_reservations expired_reservation
      where expired_reservation.farm_id = p_farm_id
        and expired_reservation.status = 'released'
    )
    and invitation.status in ('pending', 'accepted')
    and invitation.setup_expires_at <= statement_timestamp();

  select * into existing
  from public.farm_staff_seat_reservations
  where farm_id = p_farm_id and idempotency_key_hash = p_idempotency_key_hash
  for update;
  if found then
    if existing.payload_hash <> p_payload_hash then
      raise exception 'Idempotency key was already used with different staff invitation data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'reservationId', existing.id, 'status', existing.status,
      'expiresAt', existing.expires_at, 'reused', true
    );
  end if;
  if exists (
    select 1
    from auth.users account
    join public.farm_memberships membership
      on membership.farm_id = p_farm_id and membership.user_id = account.id
    where lower(account.email) = normalized_email
  ) then
    raise exception 'This user is already a member of the farm.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.farm_invitations invitation
    where invitation.farm_id = p_farm_id
      and lower(invitation.email) = normalized_email
      and invitation.reservation_id is null
      and invitation.status in ('pending', 'accepted')
      and (invitation.setup_expires_at is null or invitation.setup_expires_at > statement_timestamp())
  ) then
    raise exception 'An active invitation already exists for this email.' using errcode = 'P0001';
  end if;

  quota_feature := public.get_farm_quota_feature(p_farm_id, 'max_staff_users');
  if quota_feature ->> 'configured' <> 'true' then
    raise exception 'The additional staff limit is not configured.' using errcode = '55000';
  end if;
  if quota_feature ->> 'enabled' <> 'true' then
    raise exception 'Staff accounts are not enabled for this plan.' using errcode = '55000';
  end if;
  occupied_seats := public.count_occupied_farm_staff_seats(p_farm_id);
  if quota_feature -> 'limit' <> 'null'::jsonb
    and occupied_seats >= (quota_feature ->> 'limit')::bigint then
    raise exception 'STAFF_SEAT_QUOTA_EXCEEDED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'usage', occupied_seats,
              'limit', (quota_feature ->> 'limit')::bigint
            )::text;
  end if;

  insert into public.farm_staff_seat_reservations (
    farm_id, idempotency_key_hash, payload_hash, email, role, full_name,
    invited_by, expires_at
  ) values (
    p_farm_id, p_idempotency_key_hash, p_payload_hash, normalized_email, p_role,
    nullif(trim(p_full_name), ''), auth.uid(), statement_timestamp() + interval '7 days'
  )
  on conflict (farm_id, idempotency_key_hash) do nothing
  returning * into reservation;

  if reservation.id is null then
    select * into reservation
    from public.farm_staff_seat_reservations
    where farm_id = p_farm_id and idempotency_key_hash = p_idempotency_key_hash
    for update;
    if reservation.payload_hash <> p_payload_hash then
      raise exception 'Idempotency key was already used with different staff invitation data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'reservationId', reservation.id, 'status', reservation.status,
      'expiresAt', reservation.expires_at, 'reused', true
    );
  end if;

  return jsonb_build_object(
    'reservationId', reservation.id, 'status', reservation.status,
    'expiresAt', reservation.expires_at, 'reused', false
  );
end;
$$;

revoke all on function public.reserve_farm_staff_seat(uuid, text, public.farm_role, text, text, text) from public, anon;
grant execute on function public.reserve_farm_staff_seat(uuid, text, public.farm_role, text, text, text) to authenticated;

create or replace function public.get_financial_correction_requests(
  p_farm_id uuid,
  p_page_size integer default 25,
  p_page_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with authorized as (
    select public.has_farm_permission(p_farm_id, 'finance.view') as full_access,
           public.has_farm_permission(p_farm_id, 'finance.corrections.initiate') as can_initiate
  ),
  page_rows as (
    select request.id, request.farm_id, request.correction_kind,
           request.source_sale_id, request.source_payment_id,
           request.source_cash_entry_id, request.source_opening_cash_id,
           request.birds_sold_delta, request.live_weight_sold_kg_delta,
           request.revenue_kes_delta, request.amount_kes, request.reason,
           request.initiated_by, request.created_at,
           coalesce(decision.decision, 'pending') as status,
           decision.decided_by, decision.reason as decision_reason, decision.decided_at
    from public.financial_correction_requests request
    left join public.financial_correction_decisions decision
      on decision.farm_id = request.farm_id and decision.request_id = request.id
    cross join authorized access
    where request.farm_id = p_farm_id
      and access.can_initiate
      and (access.full_access or request.initiated_by = (select auth.uid()))
    order by request.created_at desc, request.id desc
    limit greatest(1, least(coalesce(p_page_size, 25), 100))
    offset greatest(0, coalesce(p_page_offset, 0))
  )
  select jsonb_build_object(
    'data', coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc), '[]'::jsonb),
    'total', (
      select count(*) from public.financial_correction_requests request
      cross join authorized access
      where request.farm_id = p_farm_id and access.can_initiate
        and (access.full_access or request.initiated_by = (select auth.uid()))
    ),
    'hasMore', (
      select count(*) > greatest(0, coalesce(p_page_offset, 0))
        + greatest(1, least(coalesce(p_page_size, 25), 100))
      from public.financial_correction_requests request
      cross join authorized access
      where request.farm_id = p_farm_id and access.can_initiate
        and (access.full_access or request.initiated_by = (select auth.uid()))
    )
  )
  from page_rows;
$$;

revoke all on function public.get_financial_correction_requests(uuid, integer, integer) from public, anon;
grant execute on function public.get_financial_correction_requests(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
