create index if not exists corrections_farm_source_record_idx
  on public.corrections (farm_id, source_table, source_record_id);

create or replace function public.get_revenue_ledger_page(
  p_farm_id uuid,
  p_batch_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_payment_status text default null,
  p_search text default null,
  p_cursor_date date default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id text default null,
  p_page_size integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered_sales as materialized (
    select s.*
    from public.sales s
    where s.farm_id = p_farm_id
      and (p_batch_id is null or s.batch_id = p_batch_id)
      and (p_from is null or s.sale_date >= p_from)
      and (p_to is null or s.sale_date <= p_to)
      and (
        nullif(btrim(p_search), '') is null
        or s.customer ilike '%' ||
          replace(
            replace(
              replace(btrim(p_search), chr(92), chr(92) || chr(92)),
              '%', chr(92) || '%'
            ),
            '_', chr(92) || '_'
          ) || '%' escape chr(92)
      )
  ),
  correction_totals as (
    select c.source_record_id as sale_id,
           sum(c.birds_sold_delta)::numeric as birds_sold_delta,
           sum(c.live_weight_sold_kg_delta) as live_weight_sold_kg_delta,
           sum(round(c.revenue_kes_delta * 100)) as revenue_cents_delta,
           sum(round(c.paid_kes_delta * 100)) as paid_cents_delta
    from public.corrections c
    join filtered_sales s on s.id = c.source_record_id
    where c.farm_id = p_farm_id
      and c.source_table = 'sales'
    group by c.source_record_id
  ),
  payment_totals as (
    select p.sale_id, sum(round(p.amount_kes * 100)) as paid_cents
    from public.sale_payments p
    join filtered_sales s on s.id = p.sale_id
    where p.farm_id = p_farm_id
    group by p.sale_id
  ),
  sale_rows as (
    select s.id::text as id,
           s.farm_id,
           s.batch_id,
           s.sale_date,
           s.customer,
           s.birds_sold::numeric + coalesce(c.birds_sold_delta, 0) as birds_sold,
           s.total_weight_kg + coalesce(c.live_weight_sold_kg_delta, 0) as total_weight_kg,
           s.price_basis::text as price_basis,
           s.price_kes,
           round(s.amount_kes * 100) + coalesce(c.revenue_cents_delta, 0) as amount_cents,
           coalesce(p.paid_cents, 0) + coalesce(c.paid_cents_delta, 0) as paid_cents,
           s.receipt_number,
           s.remarks,
           s.created_at,
           false as is_adjustment
    from filtered_sales s
    left join correction_totals c on c.sale_id = s.id
    left join payment_totals p on p.sale_id = s.id
  ),
  adjustment_rows as (
    select ('correction:' || c.id::text) as id,
           c.farm_id,
           c.batch_id,
           (c.created_at at time zone 'Africa/Nairobi')::date as sale_date,
           'Closed-batch adjustment'::text as customer,
           c.birds_sold_delta::numeric as birds_sold,
           c.live_weight_sold_kg_delta as total_weight_kg,
           null::text as price_basis,
           null::numeric as price_kes,
           round(c.revenue_kes_delta * 100) as amount_cents,
           round(c.paid_kes_delta * 100) as paid_cents,
           null::text as receipt_number,
           c.reason as remarks,
           c.created_at,
           true as is_adjustment
    from public.corrections c
    where c.farm_id = p_farm_id
      and c.source_table = 'sales'
      and c.source_record_id is null
      and nullif(btrim(p_search), '') is null
      and (p_batch_id is null or c.batch_id = p_batch_id)
      and (
        p_from is null
        or (c.created_at at time zone 'Africa/Nairobi')::date >= p_from
      )
      and (
        p_to is null
        or (c.created_at at time zone 'Africa/Nairobi')::date <= p_to
      )
  ),
  all_rows as (
    select * from sale_rows
    union all
    select * from adjustment_rows
  ),
  revenue_rows as (
    select r.*,
           r.amount_cents / 100 as amount_kes,
           r.paid_cents / 100 as paid_kes,
           greatest(r.amount_cents - r.paid_cents, 0) / 100 as outstanding_kes,
           case
             when r.paid_cents >= r.amount_cents then 'paid'
             when r.paid_cents > 0 then 'partial'
             else 'unpaid'
           end as payment_status
    from all_rows r
  ),
  filtered_rows as materialized (
    select *
    from revenue_rows r
    where p_payment_status is null or r.payment_status = p_payment_status
  ),
  summary as (
    select count(*)::bigint as sale_count,
           coalesce(sum(amount_cents), 0) / 100 as sales_kes,
           coalesce(sum(paid_cents), 0) / 100 as received_kes,
           greatest(coalesce(sum(amount_cents), 0) - coalesce(sum(paid_cents), 0), 0) / 100
             as outstanding_kes
    from filtered_rows
  ),
  candidates as materialized (
    select *
    from filtered_rows r
    where p_cursor_date is null
       or (r.sale_date, r.created_at, r.id)
          < (p_cursor_date, p_cursor_created_at, p_cursor_id)
    order by r.sale_date desc, r.created_at desc, r.id desc
    limit greatest(1, least(coalesce(p_page_size, 25), 100)) + 1
  ),
  page_rows as materialized (
    select *
    from candidates
    order by sale_date desc, created_at desc, id desc
    limit greatest(1, least(coalesce(p_page_size, 25), 100))
  ),
  last_page_row as (
    select sale_date, created_at, id
    from page_rows
    order by sale_date asc, created_at asc, id asc
    limit 1
  )
  select jsonb_build_object(
    'data',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(p) - 'amount_cents' - 'paid_cents'
          order by p.sale_date desc, p.created_at desc, p.id desc
        )
        from page_rows p
      ),
      '[]'::jsonb
    ),
    'summary',
    (
      select jsonb_build_object(
        'sales_kes', s.sales_kes,
        'received_kes', s.received_kes,
        'outstanding_kes', s.outstanding_kes,
        'sale_count', s.sale_count
      )
      from summary s
    ),
    'hasMore',
    (select count(*) > greatest(1, least(coalesce(p_page_size, 25), 100)) from candidates),
    'nextCursor',
    (
      select jsonb_build_object(
        'saleDate', l.sale_date,
        'createdAt', l.created_at,
        'id', l.id
      )
      from last_page_row l
      where (select count(*) > greatest(1, least(coalesce(p_page_size, 25), 100)) from candidates)
    )
  );
$$;

revoke all on function public.get_revenue_ledger_page(
  uuid, uuid, date, date, text, text, date, timestamptz, text, integer
) from public;
grant execute on function public.get_revenue_ledger_page(
  uuid, uuid, date, date, text, text, date, timestamptz, text, integer
) to authenticated;

notify pgrst, 'reload schema';
