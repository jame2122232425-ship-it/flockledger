alter table public.farms
  add column opening_cash_balance_kes numeric(12, 2) not null default 0
    check (opening_cash_balance_kes >= 0);

create function public.create_farm(farm_name text, opening_balance_kes numeric)
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
  if opening_balance_kes < 0 then
    raise exception 'Opening cash balance cannot be negative';
  end if;

  insert into public.farms (name, opening_cash_balance_kes, created_by)
  values (trim(farm_name), coalesce(opening_balance_kes, 0), auth.uid())
  returning id into new_farm_id;

  insert into public.farm_memberships (farm_id, user_id, role)
  values (new_farm_id, auth.uid(), 'owner');
  return new_farm_id;
end;
$$;

revoke all on function public.create_farm(text, numeric) from public;
grant execute on function public.create_farm(text, numeric) to authenticated;

create view public.farm_dashboard
with (security_invoker = true)
as
with batch_totals as (
  select farm_id,
         count(*) as batches_recorded,
         coalesce(sum(chicks_received), 0) as birds_placed,
         coalesce(sum(revenue_kes), 0) as revenue_kes,
         coalesce(sum(total_cost_kes), 0) as tagged_expenses_kes,
         coalesce(sum(profit_kes), 0) as tagged_batch_profit_kes,
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
correction_cash_totals as (
  select farm_id,
         coalesce(sum(money_in_kes_delta), 0) as cash_in_delta_kes,
         coalesce(sum(money_out_kes_delta), 0) as cash_out_delta_kes,
         coalesce(sum(feed_consumed_kg_delta), 0) as feed_consumed_delta_kg
  from public.corrections
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
)
select f.id as farm_id,
       f.name as farm_name,
       f.currency,
       f.timezone,
       f.opening_cash_balance_kes,
       coalesce(b.batches_recorded, 0) as batches_recorded,
       coalesce(b.birds_placed, 0) as birds_placed,
       coalesce(b.revenue_kes, 0) as revenue_kes,
       coalesce(c.cash_out_kes, 0) + coalesce(cc.cash_out_delta_kes, 0) as total_expenses_kes,
       coalesce(b.tagged_batch_profit_kes, 0) as tagged_batch_profit_kes,
       coalesce(c.untagged_expenses_kes, 0) as untagged_expenses_kes,
       coalesce(fd.delivered_kg, 0)
         - coalesce(fc.consumed_kg, 0)
         - coalesce(cc.feed_consumed_delta_kg, 0) as feed_stock_on_hand_kg,
       coalesce(b.accounts_receivable_kes, 0) as accounts_receivable_kes,
       f.opening_cash_balance_kes
         + coalesce(c.cash_in_kes, 0) + coalesce(cc.cash_in_delta_kes, 0)
         - coalesce(c.cash_out_kes, 0) - coalesce(cc.cash_out_delta_kes, 0) as cash_balance_kes
from public.farms f
left join batch_totals b on b.farm_id = f.id
left join cash_totals c on c.farm_id = f.id
left join correction_cash_totals cc on cc.farm_id = f.id
left join feed_deliveries fd on fd.farm_id = f.id
left join feed_consumption fc on fc.farm_id = f.id;

comment on view public.farm_dashboard is
'Farm-wide totals for the workbook dashboard. Cash balance includes opening balance and append-only cash corrections; feed on hand is deliveries less recorded consumption.';

grant select on public.farm_dashboard to authenticated;
revoke all on public.farm_dashboard from anon;

notify pgrst, 'reload schema';
