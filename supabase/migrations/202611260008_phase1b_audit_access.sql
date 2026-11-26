create table public.audit_access_logs (
  id bigint generated always as identity primary key,
  farm_id uuid references public.farms(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  category text not null check (category in (
    'all', 'operational', 'financial', 'inventory', 'platform_governance'
  )),
  access_type text not null check (access_type in ('list', 'export')),
  request_id text,
  accessed_at timestamptz not null default now()
);

create index audit_access_logs_farm_time_idx
  on public.audit_access_logs (farm_id, accessed_at desc);
create index audit_access_logs_actor_time_idx
  on public.audit_access_logs (actor_user_id, accessed_at desc);

alter table public.audit_access_logs enable row level security;
revoke all on public.audit_access_logs from public, anon, authenticated;

create function public.prevent_audit_access_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit access logs are append-only';
end;
$$;

create trigger audit_access_logs_append_only
before update or delete on public.audit_access_logs
for each row execute function public.prevent_audit_access_log_mutation();

revoke all on function public.prevent_audit_access_log_mutation() from public, anon, authenticated;

create function public.get_farm_audit_page(
  p_farm_id uuid,
  p_category text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page_size integer default 25,
  p_page_offset integer default 0,
  p_is_export boolean default false,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_permission text;
  has_full_detail boolean;
  row_limit integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_category not in ('all', 'operational', 'financial', 'inventory')
    or (p_from is not null and p_to is not null and p_from > p_to)
    or (p_is_export and greatest(coalesce(p_page_offset, 0), 0) <> 0) then
    raise exception 'Invalid audit query.' using errcode = '22023';
  end if;

  required_permission := case p_category
    when 'all' then 'audit.view.full'
    when 'operational' then 'audit.view.operational'
    when 'financial' then 'audit.view.financial'
    when 'inventory' then 'audit.view.inventory'
  end;
  if not public.has_farm_permission(p_farm_id, required_permission) then
    raise exception 'You cannot view this audit category.' using errcode = '42501';
  end if;
  has_full_detail := public.has_farm_permission(p_farm_id, 'audit.view.full')
    or p_category = 'financial';
  row_limit := case
    when p_is_export then greatest(1, least(coalesce(p_page_size, 1000), 1000))
    else greatest(1, least(coalesce(p_page_size, 25), 100))
  end;

  insert into public.audit_access_logs (
    farm_id, actor_user_id, category, access_type, request_id
  ) values (
    p_farm_id, auth.uid(), p_category,
    case when p_is_export then 'export' else 'list' end,
    left(p_request_id, 128)
  );

  return jsonb_build_object(
    'data',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', event.id,
          'farm_id', event.farm_id,
          'table_name', event.table_name,
          'record_id', event.record_id,
          'operation', event.operation,
          'actor_id', case when has_full_detail then event.actor_id else null end,
          'old_data', case when has_full_detail then event.old_data else null end,
          'new_data', case when has_full_detail then event.new_data else null end,
          'occurred_at', event.occurred_at
        )
        order by event.occurred_at desc, event.id desc
      )
      from (
        select audit.*
        from public.audit_events audit
        where audit.farm_id = p_farm_id
          and (p_from is null or audit.occurred_at >= p_from)
          and (p_to is null or audit.occurred_at <= p_to)
          and (
            p_category = 'all'
            or (
              p_category = 'financial'
              and audit.table_name in (
                'sales', 'sale_payments', 'sale_refunds', 'cash_entries',
                'corrections', 'sale_adjustments',
                'financial_correction_requests', 'financial_correction_decisions',
                'farm_opening_cash_records', 'legacy_financial_reconciliation',
                'legacy_financial_reconciliation_decisions'
              )
            )
            or (
              p_category = 'inventory'
              and audit.table_name in ('inventory_items', 'stock_movements')
            )
            or (
              p_category = 'operational'
              and audit.table_name not in (
                'sales', 'sale_payments', 'sale_refunds', 'cash_entries',
                'corrections', 'sale_adjustments',
                'financial_correction_requests', 'financial_correction_decisions',
                'farm_opening_cash_records', 'legacy_financial_reconciliation',
                'legacy_financial_reconciliation_decisions',
                'inventory_items', 'stock_movements'
              )
            )
          )
        order by audit.occurred_at desc, audit.id desc
        offset case when p_is_export then 0 else greatest(0, coalesce(p_page_offset, 0)) end
        limit row_limit
      ) event
    ), '[]'::jsonb),
    'total',
    (
      select count(*)
      from public.audit_events audit
      where audit.farm_id = p_farm_id
        and (p_from is null or audit.occurred_at >= p_from)
        and (p_to is null or audit.occurred_at <= p_to)
        and (
          p_category = 'all'
          or (p_category = 'financial' and audit.table_name in (
            'sales', 'sale_payments', 'sale_refunds', 'cash_entries',
            'corrections', 'sale_adjustments', 'financial_correction_requests',
            'financial_correction_decisions', 'farm_opening_cash_records',
            'legacy_financial_reconciliation', 'legacy_financial_reconciliation_decisions'
          ))
          or (p_category = 'inventory' and audit.table_name in ('inventory_items', 'stock_movements'))
          or (p_category = 'operational' and audit.table_name not in (
            'sales', 'sale_payments', 'sale_refunds', 'cash_entries', 'corrections',
            'sale_adjustments', 'financial_correction_requests', 'financial_correction_decisions',
            'farm_opening_cash_records', 'legacy_financial_reconciliation',
            'legacy_financial_reconciliation_decisions', 'inventory_items', 'stock_movements'
          ))
        )
    ),
    'hasMore',
    (
      select count(*) > greatest(0, coalesce(p_page_offset, 0)) + row_limit
      from public.audit_events audit
      where audit.farm_id = p_farm_id
        and (p_from is null or audit.occurred_at >= p_from)
        and (p_to is null or audit.occurred_at <= p_to)
        and (
          p_category = 'all'
          or (p_category = 'financial' and audit.table_name in (
            'sales', 'sale_payments', 'sale_refunds', 'cash_entries',
            'corrections', 'sale_adjustments', 'financial_correction_requests',
            'financial_correction_decisions', 'farm_opening_cash_records',
            'legacy_financial_reconciliation', 'legacy_financial_reconciliation_decisions'
          ))
          or (p_category = 'inventory' and audit.table_name in ('inventory_items', 'stock_movements'))
          or (p_category = 'operational' and audit.table_name not in (
            'sales', 'sale_payments', 'sale_refunds', 'cash_entries', 'corrections',
            'sale_adjustments', 'financial_correction_requests', 'financial_correction_decisions',
            'farm_opening_cash_records', 'legacy_financial_reconciliation',
            'legacy_financial_reconciliation_decisions', 'inventory_items', 'stock_movements'
          ))
        )
    )
  );
end;
$$;

create function public.get_platform_audit_page(
  p_page_size integer default 25,
  p_page_offset integer default 0,
  p_is_export boolean default false,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_limit integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if p_is_export and greatest(coalesce(p_page_offset, 0), 0) <> 0 then
    raise exception 'Platform audit exports cannot use an offset.' using errcode = '22023';
  end if;
  row_limit := case
    when p_is_export then greatest(1, least(coalesce(p_page_size, 1000), 1000))
    else greatest(1, least(coalesce(p_page_size, 25), 100))
  end;

  insert into public.audit_access_logs (
    actor_user_id, category, access_type, request_id
  ) values (
    auth.uid(), 'platform_governance',
    case when p_is_export then 'export' else 'list' end,
    left(p_request_id, 128)
  );

  return jsonb_build_object(
    'data',
    coalesce((
      select jsonb_agg(to_jsonb(event) order by event.occurred_at desc, event.id desc)
      from (
        select id, actor_user_id, event_type, application_id, farm_id,
               reason, details, request_id, occurred_at
        from public.platform_audit_events
        order by occurred_at desc, id desc
        offset case when p_is_export then 0 else greatest(0, coalesce(p_page_offset, 0)) end
        limit row_limit
      ) event
    ), '[]'::jsonb),
    'total', (select count(*) from public.platform_audit_events),
    'hasMore', (
      select count(*) > greatest(0, coalesce(p_page_offset, 0)) + row_limit
      from public.platform_audit_events
    )
  );
end;
$$;

revoke all on function public.get_farm_audit_page(
  uuid, text, timestamptz, timestamptz, integer, integer, boolean, text
) from public, anon;
revoke all on function public.get_platform_audit_page(integer, integer, boolean, text) from public, anon;
grant execute on function public.get_farm_audit_page(
  uuid, text, timestamptz, timestamptz, integer, integer, boolean, text
) to authenticated;
grant execute on function public.get_platform_audit_page(integer, integer, boolean, text)
  to authenticated;

notify pgrst, 'reload schema';
