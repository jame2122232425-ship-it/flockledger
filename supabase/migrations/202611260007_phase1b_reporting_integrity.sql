drop view public.farm_dashboard;
drop view public.batch_performance;

create function public.get_batch_operational_sales(
  p_farm_id uuid,
  p_batch_id uuid
)
returns table (birds_sold bigint, live_weight_sold_kg numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_farm_member(p_farm_id) then
    raise exception 'Farm membership required.' using errcode = '42501';
  end if;
  return query
  select
    coalesce((
      select sum(sale.birds_sold + coalesce(adjustment.birds_sold_delta, 0))
      from public.sales sale
      left join (
        select farm_id, sale_id, sum(birds_sold_delta)::bigint as birds_sold_delta
        from public.sale_adjustments
        group by farm_id, sale_id
      ) adjustment on adjustment.farm_id = sale.farm_id and adjustment.sale_id = sale.id
      where sale.farm_id = p_farm_id and sale.batch_id = p_batch_id
    ), 0)
    + coalesce((
      select sum(correction.birds_sold_delta)
      from public.corrections correction
      where correction.farm_id = p_farm_id
        and correction.batch_id = p_batch_id
        and correction.source_table = 'sales'
    ), 0),
    coalesce((
      select sum(sale.total_weight_kg + coalesce(adjustment.live_weight_sold_kg_delta, 0))
      from public.sales sale
      left join (
        select farm_id, sale_id,
               sum(live_weight_sold_kg_delta) as live_weight_sold_kg_delta
        from public.sale_adjustments
        group by farm_id, sale_id
      ) adjustment on adjustment.farm_id = sale.farm_id and adjustment.sale_id = sale.id
      where sale.farm_id = p_farm_id and sale.batch_id = p_batch_id
    ), 0)
    + coalesce((
      select sum(correction.live_weight_sold_kg_delta)
      from public.corrections correction
      where correction.farm_id = p_farm_id
        and correction.batch_id = p_batch_id
        and correction.source_table = 'sales'
    ), 0);
end;
$$;

revoke all on function public.get_batch_operational_sales(uuid, uuid) from public, anon;
grant execute on function public.get_batch_operational_sales(uuid, uuid) to authenticated;

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
sale_adjustment_totals as (
  select farm_id, sale_id,
         sum(birds_sold_delta)::bigint as birds_sold_delta,
         sum(live_weight_sold_kg_delta) as live_weight_sold_kg_delta,
         sum(revenue_kes_delta) as revenue_kes_delta
  from public.sale_adjustments
  group by farm_id, sale_id
),
legacy_linked_revenue as (
  select farm_id, source_record_id as sale_id,
         sum(revenue_kes_delta) as revenue_kes_delta
  from public.legacy_financial_reconciliation
  where source_table = 'sales' and source_record_id is not null
  group by farm_id, source_record_id
),
legacy_unlinked_revenue as (
  select farm_id, batch_id, sum(revenue_kes_delta) as revenue_kes_delta
  from public.legacy_financial_reconciliation
  where source_table = 'sales' and source_record_id is null
  group by farm_id, batch_id
),
payment_totals as (
  select payment.farm_id, payment.sale_id,
         sum(payment.amount_kes) as paid_kes
  from public.sale_payments payment
  group by payment.farm_id, payment.sale_id
),
refund_totals as (
  select refund.farm_id, refund.sale_id,
         sum(refund.amount_kes) as refunded_kes
  from public.sale_refunds refund
  group by refund.farm_id, refund.sale_id
),
sale_totals as (
  select sale.farm_id, sale.batch_id,
         sum(sale.birds_sold + coalesce(adjustment.birds_sold_delta, 0))::bigint as birds_sold,
         sum(sale.total_weight_kg + coalesce(adjustment.live_weight_sold_kg_delta, 0))
           as live_weight_sold_kg,
         sum(sale.amount_kes + coalesce(adjustment.revenue_kes_delta, 0)
             + coalesce(legacy.revenue_kes_delta, 0)) as revenue_kes,
         sum(coalesce(payment.paid_kes, 0) - coalesce(refund.refunded_kes, 0)) as paid_kes
  from public.sales sale
  left join sale_adjustment_totals adjustment
    on adjustment.farm_id = sale.farm_id and adjustment.sale_id = sale.id
  left join legacy_linked_revenue legacy
    on legacy.farm_id = sale.farm_id and legacy.sale_id = sale.id
  left join payment_totals payment
    on payment.farm_id = sale.farm_id and payment.sale_id = sale.id
  left join refund_totals refund
    on refund.farm_id = sale.farm_id and refund.sale_id = sale.id
  group by sale.farm_id, sale.batch_id
),
cash_totals as (
  select farm_id, batch_id,
         sum(money_in_kes) as cash_in_kes,
         sum(money_out_kes) as cash_out_kes
  from public.cash_entries
  where batch_id is not null
  group by farm_id, batch_id
),
payment_cash_totals as (
  select sale.farm_id, sale.batch_id, sum(payment.amount_kes) as cash_in_kes
  from public.sale_payments payment
  join public.sales sale
    on sale.farm_id = payment.farm_id and sale.id = payment.sale_id
  group by sale.farm_id, sale.batch_id
),
refund_cash_totals as (
  select sale.farm_id, sale.batch_id, sum(refund.amount_kes) as cash_out_kes
  from public.sale_refunds refund
  join public.sales sale
    on sale.farm_id = refund.farm_id and sale.id = refund.sale_id
  group by sale.farm_id, sale.batch_id
),
correction_totals as (
  select farm_id, batch_id,
         sum(dead_delta)::bigint as dead_delta,
         sum(culled_delta)::bigint as culled_delta,
         sum(birds_sold_delta)::bigint as birds_sold_delta,
         sum(live_weight_sold_kg_delta) as live_weight_sold_kg_delta,
         sum(feed_consumed_kg_delta) as feed_consumed_kg_delta
  from public.corrections
  group by farm_id, batch_id
),
latest_weight as (
  select distinct on (farm_id, batch_id)
         farm_id, batch_id, total_weight_g / birds_weighed / 1000 as avg_weight_kg
  from public.weight_records
  order by farm_id, batch_id, record_date desc, created_at desc
),
totals as (
  select batch.farm_id, batch.id as batch_id, batch.batch_code, batch.batch_type,
         batch.status, batch.date_placed, batch.date_sold_out, batch.chicks_received,
         batch.house,
         coalesce(daily.dead, 0) + coalesce(correction.dead_delta, 0) as dead,
         coalesce(daily.culled, 0) + coalesce(correction.culled_delta, 0) as culled,
         coalesce(operational_sale.birds_sold, 0) as birds_sold,
         coalesce(operational_sale.live_weight_sold_kg, 0) as live_weight_sold_kg,
         coalesce(daily.feed_consumed_kg, 0)
           + coalesce(correction.feed_consumed_kg_delta, 0) as feed_consumed_kg,
         coalesce(sale.revenue_kes, 0) + coalesce(legacy.revenue_kes_delta, 0) as revenue_kes,
         coalesce(sale.paid_kes, 0) as paid_kes,
         coalesce(cash.cash_in_kes, 0) + coalesce(payment_cash.cash_in_kes, 0) as cash_in_kes,
         coalesce(cash.cash_out_kes, 0) + coalesce(refund_cash.cash_out_kes, 0) as cash_out_kes,
         weight.avg_weight_kg,
         greatest(
           batch.chicks_received
           - coalesce(daily.dead, 0) - coalesce(daily.culled, 0)
           - coalesce(correction.dead_delta, 0) - coalesce(correction.culled_delta, 0)
           - coalesce(operational_sale.birds_sold, 0),
           0
         ) as birds_remaining
  from public.batches batch
  left join daily_totals daily
    on daily.farm_id = batch.farm_id and daily.batch_id = batch.id
  left join sale_totals sale
    on sale.farm_id = batch.farm_id and sale.batch_id = batch.id
  left join legacy_unlinked_revenue legacy
    on legacy.farm_id = batch.farm_id and legacy.batch_id = batch.id
  left join cash_totals cash
    on cash.farm_id = batch.farm_id and cash.batch_id = batch.id
  left join payment_cash_totals payment_cash
    on payment_cash.farm_id = batch.farm_id and payment_cash.batch_id = batch.id
  left join refund_cash_totals refund_cash
    on refund_cash.farm_id = batch.farm_id and refund_cash.batch_id = batch.id
  left join correction_totals correction
    on correction.farm_id = batch.farm_id and correction.batch_id = batch.id
  left join latest_weight weight
    on weight.farm_id = batch.farm_id and weight.batch_id = batch.id
  left join lateral public.get_batch_operational_sales(batch.farm_id, batch.id)
    as operational_sale on true
),
metrics as (
  select totals.*,
         cash_out_kes as total_cost_kes,
         revenue_kes - cash_out_kes as profit_kes,
         case when status = 'closed' then
           case when live_weight_sold_kg > 0 then feed_consumed_kg / live_weight_sold_kg end
         else
           case when live_weight_sold_kg + birds_remaining * coalesce(avg_weight_kg, 0) > 0
             and (birds_remaining = 0 or avg_weight_kg is not null)
           then feed_consumed_kg
             / (live_weight_sold_kg + birds_remaining * coalesce(avg_weight_kg, 0))
           end
         end as fcr,
         case when status = 'closed' then date_sold_out - date_placed + 1
           else greatest((timezone('Africa/Nairobi', now())::date - date_placed + 1), 0)
         end as age_days
  from totals
)
select farm_id, batch_id, batch_code, batch_type, status,
       date_placed, date_sold_out, chicks_received,
       dead, culled, birds_sold, live_weight_sold_kg, feed_consumed_kg,
       revenue_kes, paid_kes, revenue_kes - paid_kes as outstanding_kes,
       total_cost_kes, profit_kes, fcr,
       case when birds_sold > 0 then live_weight_sold_kg / birds_sold end as avg_live_weight_sold_kg,
       case when chicks_received > 0 then (dead + culled) * 100.0 / chicks_received end as mortality_percent,
       case when chicks_received > 0 then 100.0 - (dead + culled) * 100.0 / chicks_received end as livability_percent,
       age_days,
       case when birds_sold > 0 then total_cost_kes / birds_sold end as cost_per_bird_sold_kes,
       case when live_weight_sold_kg > 0 then total_cost_kes / live_weight_sold_kg end as cost_per_kg_sold_kes,
       case when birds_sold > 0 then profit_kes / birds_sold end as profit_per_bird_sold_kes,
       case when batch_type = 'Broiler' and age_days > 0 and fcr > 0 and birds_sold > 0
         then (
           (100.0 - (dead + culled) * 100.0 / chicks_received)
           * (live_weight_sold_kg / birds_sold) * 100
         ) / (age_days * fcr)
       end as epef,
       cash_in_kes, cash_out_kes, house
from metrics;

grant select on public.batch_performance to authenticated;
revoke all on public.batch_performance from anon;

create view public.farm_dashboard
with (security_invoker = true)
as
with batch_totals as (
  select farm_id,
         count(*) as batches_recorded,
         coalesce(sum(chicks_received), 0) as birds_placed,
         coalesce(sum(revenue_kes), 0) as revenue_kes,
         coalesce(sum(total_cost_kes), 0) as tagged_batch_profit_kes,
         coalesce(sum(outstanding_kes), 0) as accounts_receivable_kes
  from public.batch_performance
  group by farm_id
),
cash_totals as (
  select farm_id,
         coalesce(sum(money_in_kes), 0) as cash_in_kes,
         coalesce(sum(money_out_kes), 0) as cash_out_kes,
         coalesce(sum(money_out_kes) filter (where batch_id is null), 0) as untagged_expenses_kes
  from public.cash_entries
  group by farm_id
),
feed_deliveries as (
  select farm_id, sum(bags * kg_per_bag) as delivered_kg
  from public.feed_deliveries
  group by farm_id
),
feed_consumption as (
  select farm_id, sum(greatest(feed_given_kg - feed_left_kg, 0)) as consumed_kg
  from public.daily_records
  group by farm_id
),
operational_corrections as (
  select farm_id, sum(feed_consumed_kg_delta) as feed_consumed_delta_kg
  from public.corrections
  where source_table = 'daily_records'
  group by farm_id
),
opening_cash as (
  select farm_id, amount_kes
  from public.farm_opening_cash_records
)
select farm.id as farm_id,
       farm.name as farm_name,
       farm.currency,
       farm.timezone,
       coalesce(opening.amount_kes, 0) as opening_cash_balance_kes,
       coalesce(batch.batches_recorded, 0) as batches_recorded,
       coalesce(batch.birds_placed, 0) as birds_placed,
       coalesce(batch.revenue_kes, 0) as revenue_kes,
       coalesce(cash.cash_out_kes, 0) as total_expenses_kes,
       coalesce(batch.tagged_batch_profit_kes, 0) as tagged_batch_profit_kes,
       coalesce(cash.untagged_expenses_kes, 0) as untagged_expenses_kes,
       coalesce(delivery.delivered_kg, 0)
         - coalesce(consumption.consumed_kg, 0)
         - coalesce(correction.feed_consumed_delta_kg, 0) as feed_stock_on_hand_kg,
       coalesce(batch.accounts_receivable_kes, 0) as accounts_receivable_kes,
       coalesce(opening.amount_kes, 0) + coalesce(cash.cash_in_kes, 0)
         - coalesce(cash.cash_out_kes, 0) as cash_balance_kes
from public.farms farm
left join batch_totals batch on batch.farm_id = farm.id
left join cash_totals cash on cash.farm_id = farm.id
left join feed_deliveries delivery on delivery.farm_id = farm.id
left join feed_consumption consumption on consumption.farm_id = farm.id
left join operational_corrections correction on correction.farm_id = farm.id
left join opening_cash opening on opening.farm_id = farm.id;

grant select on public.farm_dashboard to authenticated;
revoke all on public.farm_dashboard from anon;

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
    select sale.*
    from public.sales sale
    where sale.farm_id = p_farm_id
      and (p_batch_id is null or sale.batch_id = p_batch_id)
      and (p_from is null or sale.sale_date >= p_from)
      and (p_to is null or sale.sale_date <= p_to)
      and (
        nullif(btrim(p_search), '') is null
        or sale.customer ilike '%' ||
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
    select correction.source_record_id as sale_id,
           sum(correction.birds_sold_delta)::numeric as birds_sold_delta,
           sum(correction.live_weight_sold_kg_delta) as live_weight_sold_kg_delta
    from public.corrections correction
    join filtered_sales sale on sale.id = correction.source_record_id
    where correction.farm_id = p_farm_id and correction.source_table = 'sales'
    group by correction.source_record_id
  ),
  sale_adjustment_totals as (
    select adjustment.sale_id,
           sum(adjustment.birds_sold_delta)::numeric as birds_sold_delta,
           sum(adjustment.live_weight_sold_kg_delta) as live_weight_sold_kg_delta,
           sum(adjustment.revenue_kes_delta) as revenue_kes_delta
    from public.sale_adjustments adjustment
    join filtered_sales sale on sale.id = adjustment.sale_id
    where adjustment.farm_id = p_farm_id
    group by adjustment.sale_id
  ),
  legacy_linked as (
    select legacy.source_record_id as sale_id,
           sum(legacy.revenue_kes_delta) as revenue_kes_delta,
           sum(legacy.paid_kes_delta) filter (where decision.id is null)
             as unreconciled_paid_kes
    from public.legacy_financial_reconciliation legacy
    join filtered_sales sale on sale.id = legacy.source_record_id
    left join public.legacy_financial_reconciliation_decisions decision
      on decision.farm_id = legacy.farm_id
      and decision.reconciliation_id = legacy.id
    where legacy.farm_id = p_farm_id
      and legacy.source_table = 'sales'
      and legacy.source_record_id is not null
    group by legacy.source_record_id
  ),
  legacy_unlinked as (
    select legacy.id, legacy.batch_id, legacy.reason, legacy.original_created_at,
           legacy.revenue_kes_delta,
           case when decision.id is null then legacy.paid_kes_delta else 0 end
             as unreconciled_paid_kes
    from public.legacy_financial_reconciliation legacy
    left join public.legacy_financial_reconciliation_decisions decision
      on decision.farm_id = legacy.farm_id
      and decision.reconciliation_id = legacy.id
    where legacy.farm_id = p_farm_id
      and legacy.source_table = 'sales'
      and legacy.source_record_id is null
      and (legacy.revenue_kes_delta <> 0 or legacy.paid_kes_delta <> 0)
      and (p_batch_id is null or legacy.batch_id = p_batch_id)
      and (
        p_from is null
        or (legacy.original_created_at at time zone 'Africa/Nairobi')::date >= p_from
      )
      and (
        p_to is null
        or (legacy.original_created_at at time zone 'Africa/Nairobi')::date <= p_to
      )
      and nullif(btrim(p_search), '') is null
  ),
  payment_totals as (
    select payment.sale_id,
           sum(payment.amount_kes) - coalesce(refund_totals.refunded_kes, 0) as paid_kes
    from public.sale_payments payment
    join filtered_sales sale on sale.id = payment.sale_id
    left join (
      select refund.farm_id, refund.sale_id, sum(refund.amount_kes) as refunded_kes
      from public.sale_refunds refund
      group by refund.farm_id, refund.sale_id
    ) refund_totals
      on refund_totals.farm_id = payment.farm_id
      and refund_totals.sale_id = payment.sale_id
    where payment.farm_id = p_farm_id
    group by payment.sale_id, refund_totals.refunded_kes
  ),
  sale_rows as (
    select sale.id::text as id,
           sale.farm_id,
           sale.batch_id,
           sale.sale_date,
           sale.customer,
           sale.birds_sold::numeric + coalesce(correction.birds_sold_delta, 0)
             + coalesce(adjustment.birds_sold_delta, 0) as birds_sold,
           sale.total_weight_kg + coalesce(correction.live_weight_sold_kg_delta, 0)
             + coalesce(adjustment.live_weight_sold_kg_delta, 0) as total_weight_kg,
           sale.price_basis::text as price_basis,
           sale.price_kes,
           round((sale.amount_kes + coalesce(adjustment.revenue_kes_delta, 0)
             + coalesce(legacy.revenue_kes_delta, 0)) * 100) as amount_cents,
           round(coalesce(payment.paid_kes, 0) * 100) as paid_cents,
           round(coalesce(legacy.unreconciled_paid_kes, 0) * 100)
             as unreconciled_paid_cents,
           sale.receipt_number,
           sale.remarks,
           sale.created_at,
           false as is_adjustment
    from filtered_sales sale
    left join correction_totals correction on correction.sale_id = sale.id
    left join sale_adjustment_totals adjustment on adjustment.sale_id = sale.id
    left join legacy_linked legacy on legacy.sale_id = sale.id
    left join payment_totals payment on payment.sale_id = sale.id
  ),
  adjustment_rows as (
    select ('legacy:' || legacy.id::text) as id,
           p_farm_id as farm_id,
           legacy.batch_id,
           (legacy.original_created_at at time zone 'Africa/Nairobi')::date as sale_date,
           'Unreconciled historical adjustment'::text as customer,
           0::numeric as birds_sold,
           0::numeric as total_weight_kg,
           null::text as price_basis,
           null::numeric as price_kes,
           round(legacy.revenue_kes_delta * 100) as amount_cents,
           0::numeric as paid_cents,
           round(legacy.unreconciled_paid_kes * 100) as unreconciled_paid_cents,
           null::text as receipt_number,
           legacy.reason as remarks,
           legacy.original_created_at as created_at,
           true as is_adjustment
    from legacy_unlinked legacy
  ),
  all_rows as (
    select * from sale_rows
    union all
    select * from adjustment_rows
  ),
  revenue_rows as (
    select revenue_row.*,
           revenue_row.amount_cents / 100 as amount_kes,
           revenue_row.paid_cents / 100 as paid_kes,
           revenue_row.unreconciled_paid_cents / 100 as unreconciled_paid_kes,
           greatest(revenue_row.amount_cents - revenue_row.paid_cents, 0) / 100 as outstanding_kes,
           case
             when revenue_row.paid_cents >= revenue_row.amount_cents then 'paid'
             when revenue_row.paid_cents > 0 then 'partial'
             else 'unpaid'
           end as payment_status
    from all_rows revenue_row
  ),
  filtered_rows as materialized (
    select *
    from revenue_rows revenue_row
    where p_payment_status is null or revenue_row.payment_status = p_payment_status
  ),
  summary as (
    select count(*)::bigint as sale_count,
           coalesce(sum(amount_cents), 0) / 100 as sales_kes,
           coalesce(sum(paid_cents), 0) / 100 as received_kes,
           greatest(coalesce(sum(amount_cents), 0) - coalesce(sum(paid_cents), 0), 0) / 100
             as outstanding_kes,
           coalesce(sum(unreconciled_paid_cents), 0) / 100 as unreconciled_paid_kes
    from filtered_rows
  ),
  candidates as materialized (
    select *
    from filtered_rows row
    where p_cursor_date is null
       or (row.sale_date, row.created_at, row.id)
          < (p_cursor_date, p_cursor_created_at, p_cursor_id)
    order by row.sale_date desc, row.created_at desc, row.id desc
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
          to_jsonb(page) - 'amount_cents' - 'paid_cents' - 'unreconciled_paid_cents'
          order by page.sale_date desc, page.created_at desc, page.id desc
        )
        from page_rows page
      ),
      '[]'::jsonb
    ),
    'summary',
    (
      select jsonb_build_object(
        'sales_kes', summary.sales_kes,
        'received_kes', summary.received_kes,
        'outstanding_kes', summary.outstanding_kes,
        'unreconciled_paid_kes', summary.unreconciled_paid_kes,
        'sale_count', summary.sale_count
      )
      from summary
    ),
    'hasMore',
    (select count(*) > greatest(1, least(coalesce(p_page_size, 25), 100)) from candidates),
    'nextCursor',
    (
      select jsonb_build_object(
        'saleDate', last_row.sale_date,
        'createdAt', last_row.created_at,
        'id', last_row.id
      )
      from last_page_row last_row
      where (select count(*) > greatest(1, least(coalesce(p_page_size, 25), 100)) from candidates)
    )
  );
$$;

revoke all on function public.get_revenue_ledger_page(
  uuid, uuid, date, date, text, text, date, timestamptz, text, integer
) from public, anon;
grant execute on function public.get_revenue_ledger_page(
  uuid, uuid, date, date, text, text, date, timestamptz, text, integer
) to authenticated;

notify pgrst, 'reload schema';
