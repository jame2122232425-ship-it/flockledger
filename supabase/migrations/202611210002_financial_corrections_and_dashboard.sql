alter table public.corrections
  add column paid_kes_delta numeric(12, 2) not null default 0,
  add column money_in_kes_delta numeric(12, 2) not null default 0,
  add column money_out_kes_delta numeric(12, 2) not null default 0;

alter table public.corrections
  drop constraint corrections_source_table_check,
  drop constraint corrections_check;

alter table public.corrections
  add constraint corrections_source_table_check
    check (source_table in ('daily_records', 'sales', 'cash_entries')),
  add constraint corrections_nonzero_check
    check (
      dead_delta <> 0 or culled_delta <> 0 or birds_sold_delta <> 0
      or live_weight_sold_kg_delta <> 0 or feed_consumed_kg_delta <> 0
      or revenue_kes_delta <> 0 or paid_kes_delta <> 0
      or money_in_kes_delta <> 0 or money_out_kes_delta <> 0
    );

create or replace function public.validate_correction()
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
  original_paid numeric := 0;
  original_cash_in numeric := 0;
  original_cash_out numeric := 0;
  net_dead numeric := 0;
  net_culled numeric := 0;
  net_feed numeric := 0;
  net_sold numeric := 0;
  net_weight numeric := 0;
  net_revenue numeric := 0;
  net_paid numeric := 0;
  net_cash_in numeric := 0;
  net_cash_out numeric := 0;
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
      or new.revenue_kes_delta <> 0
      or new.paid_kes_delta <> 0
      or new.money_in_kes_delta <> 0
      or new.money_out_kes_delta <> 0 then
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
  elsif new.source_table = 'sales' then
    if new.dead_delta <> 0 or new.culled_delta <> 0
      or new.feed_consumed_kg_delta <> 0
      or new.money_in_kes_delta <> 0 or new.money_out_kes_delta <> 0 then
      raise exception 'Sale corrections may only adjust sale quantities, weight, revenue, or payment';
    end if;

    if new.source_record_id is not null then
      select birds_sold, total_weight_kg, amount_kes, paid_kes
        into original_sold, original_weight, original_revenue, original_paid
        from public.sales
        where id = new.source_record_id and farm_id = new.farm_id and batch_id = new.batch_id;
      if not found then
        raise exception 'Source sale not found in batch';
      end if;

      select coalesce(sum(birds_sold_delta), 0),
             coalesce(sum(live_weight_sold_kg_delta), 0),
             coalesce(sum(revenue_kes_delta), 0),
             coalesce(sum(paid_kes_delta), 0)
        into net_sold, net_weight, net_revenue, net_paid
        from public.corrections
        where source_table = 'sales' and source_record_id = new.source_record_id;

      if original_sold + net_sold + new.birds_sold_delta < 0
        or original_weight + net_weight + new.live_weight_sold_kg_delta < 0
        or original_revenue + net_revenue + new.revenue_kes_delta < 0
        or original_paid + net_paid + new.paid_kes_delta < 0
        or original_paid + net_paid + new.paid_kes_delta
          > original_revenue + net_revenue + new.revenue_kes_delta then
        raise exception 'Correction would make sale totals invalid';
      end if;
    elsif new.birds_sold_delta <= 0
      or new.live_weight_sold_kg_delta < 0
      or new.revenue_kes_delta < 0
      or new.paid_kes_delta < 0
      or new.paid_kes_delta > new.revenue_kes_delta then
      raise exception 'New sale corrections require positive bird count and valid non-negative sale amounts';
    end if;
  elsif new.source_table = 'cash_entries' then
    if new.dead_delta <> 0 or new.culled_delta <> 0 or new.birds_sold_delta <> 0
      or new.live_weight_sold_kg_delta <> 0 or new.feed_consumed_kg_delta <> 0
      or new.revenue_kes_delta <> 0 or new.paid_kes_delta <> 0 then
      raise exception 'Cashbook corrections may only adjust money in or money out';
    end if;

    if new.source_record_id is not null then
      select money_in_kes, money_out_kes
        into original_cash_in, original_cash_out
        from public.cash_entries
        where id = new.source_record_id
          and farm_id = new.farm_id
          and batch_id = new.batch_id;
      if not found then
        raise exception 'Source cashbook entry not found in batch';
      end if;

      select coalesce(sum(money_in_kes_delta), 0),
             coalesce(sum(money_out_kes_delta), 0)
        into net_cash_in, net_cash_out
        from public.corrections
        where source_table = 'cash_entries' and source_record_id = new.source_record_id;

      if original_cash_in + net_cash_in + new.money_in_kes_delta < 0
        or original_cash_out + net_cash_out + new.money_out_kes_delta < 0
        or (original_cash_in + net_cash_in + new.money_in_kes_delta > 0
          and original_cash_out + net_cash_out + new.money_out_kes_delta > 0) then
        raise exception 'Correction would make cashbook entry totals invalid';
      end if;
    elsif (new.money_in_kes_delta > 0) = (new.money_out_kes_delta > 0)
      or new.money_in_kes_delta < 0 or new.money_out_kes_delta < 0 then
      raise exception 'New cashbook corrections require a positive amount in or amount out';
    end if;
  else
    raise exception 'Unsupported correction source';
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

create or replace view public.batch_performance
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
  select farm_id, batch_id,
         sum(money_in_kes) as cash_in_kes,
         sum(money_out_kes) as cash_out_kes
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
         sum(revenue_kes_delta) as revenue_kes_delta,
         sum(paid_kes_delta) as paid_kes_delta,
         sum(money_in_kes_delta) as money_in_kes_delta,
         sum(money_out_kes_delta) as money_out_kes_delta
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
  select b.farm_id, b.id as batch_id, b.batch_code, b.batch_type, b.status,
         b.date_placed, b.date_sold_out, b.chicks_received,
         coalesce(d.dead, 0) + coalesce(c.dead_delta, 0) as dead,
         coalesce(d.culled, 0) + coalesce(c.culled_delta, 0) as culled,
         coalesce(s.birds_sold, 0) + coalesce(c.birds_sold_delta, 0) as birds_sold,
         coalesce(s.live_weight_sold_kg, 0) + coalesce(c.live_weight_sold_kg_delta, 0) as live_weight_sold_kg,
         coalesce(d.feed_consumed_kg, 0) + coalesce(c.feed_consumed_kg_delta, 0) as feed_consumed_kg,
         coalesce(s.revenue_kes, 0) + coalesce(c.revenue_kes_delta, 0) as revenue_kes,
         coalesce(s.paid_kes, 0) + coalesce(c.paid_kes_delta, 0) as paid_kes,
         coalesce(ca.cash_in_kes, 0) + coalesce(c.money_in_kes_delta, 0) as cash_in_kes,
         coalesce(ca.cash_out_kes, 0) + coalesce(c.money_out_kes_delta, 0) as cash_out_kes,
         w.avg_weight_kg,
         greatest(b.chicks_received
           - coalesce(d.dead, 0) - coalesce(d.culled, 0)
           - coalesce(c.dead_delta, 0) - coalesce(c.culled_delta, 0)
           - coalesce(s.birds_sold, 0) - coalesce(c.birds_sold_delta, 0), 0) as birds_remaining
  from public.batches b
  left join daily_totals d on d.farm_id = b.farm_id and d.batch_id = b.id
  left join sale_totals s on s.farm_id = b.farm_id and s.batch_id = b.id
  left join cash_totals ca on ca.farm_id = b.farm_id and ca.batch_id = b.id
  left join correction_totals c on c.farm_id = b.farm_id and c.batch_id = b.id
  left join latest_weight w on w.farm_id = b.farm_id and w.batch_id = b.id
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
       cash_in_kes, cash_out_kes
from metrics;

comment on view public.batch_performance is
'FCR is feed consumed / live-weight output. Running batches include estimated live flock weight from the latest weight sample; closed batches use total live weight sold. Dashboard metrics include mortality, livability, age, unit costs, profit per bird, and broiler EPEF.';

grant select on public.batch_performance to authenticated;
revoke all on public.batch_performance from anon;

notify pgrst, 'reload schema';
