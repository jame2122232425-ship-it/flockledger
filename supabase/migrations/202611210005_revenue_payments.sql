alter table public.sales
  add constraint sales_farm_id_id_key unique (farm_id, id);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  payment_date date not null,
  amount_kes numeric(12, 2) not null check (amount_kes > 0),
  reference text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (farm_id, sale_id) references public.sales(farm_id, id) on delete restrict
);

alter table public.sale_payments enable row level security;

create policy sale_payments_member_read on public.sale_payments
for select to authenticated
using (public.is_farm_member(farm_id));

create policy sale_payments_authorized_insert on public.sale_payments
for insert to authenticated
with check (public.has_farm_role(
  farm_id,
  array['owner', 'manager', 'accountant']::public.farm_role[]
));

grant select, insert on public.sale_payments to authenticated;
revoke update, delete on public.sale_payments from authenticated;

insert into public.sale_payments (
  farm_id, sale_id, payment_date, amount_kes, reference, created_by, created_at
)
select farm_id, id, sale_date, paid_kes, receipt_number, created_by, created_at
from public.sales
where paid_kes > 0;

alter table public.sales disable trigger sales_audit;
update public.sales set paid_kes = 0 where paid_kes <> 0;
alter table public.sales enable trigger sales_audit;

alter table public.sales
  add constraint sales_paid_kes_legacy_zero_check check (paid_kes = 0);

alter table public.cash_entries
  add column sale_payment_id uuid unique
    references public.sale_payments(id) on delete restrict;

drop policy cash_entries_authorized_insert on public.cash_entries;
create policy cash_entries_authorized_insert on public.cash_entries
for insert to authenticated
with check (
  sale_payment_id is null
  and public.has_farm_role(
    farm_id,
    array['owner', 'manager', 'accountant']::public.farm_role[]
  )
);

create function public.prevent_sale_payment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Sale payments are append-only';
end;
$$;

create trigger sale_payments_append_only
before update or delete on public.sale_payments
for each row execute function public.prevent_sale_payment_mutation();

create function public.validate_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_batch_id uuid;
  sale_amount numeric(12, 2);
  sale_paid numeric(12, 2);
  net_revenue numeric(12, 2);
  net_paid numeric(12, 2);
  existing_payments numeric(12, 2);
begin
  if auth.uid() is null
    or new.created_by is distinct from auth.uid()
    or not public.has_farm_role(
      new.farm_id,
      array['owner', 'manager', 'accountant']::public.farm_role[]
    ) then
    raise exception 'You cannot record payments for this farm.';
  end if;

  select batch_id
    into sale_batch_id
    from public.sales
    where id = new.sale_id and farm_id = new.farm_id;
  if not found then
    raise exception 'Sale not found for farm.';
  end if;

  perform 1
    from public.batches
    where id = sale_batch_id and farm_id = new.farm_id
    for update;
  if not found then
    raise exception 'Sale batch not found for farm.';
  end if;

  select amount_kes, paid_kes
    into sale_amount, sale_paid
    from public.sales
    where id = new.sale_id and farm_id = new.farm_id
    for update;

  select coalesce(sum(amount_kes), 0)
    into existing_payments
    from public.sale_payments
    where sale_id = new.sale_id;
  select coalesce(sum(revenue_kes_delta), 0), coalesce(sum(paid_kes_delta), 0)
    into net_revenue, net_paid
    from public.corrections
    where source_table = 'sales' and source_record_id = new.sale_id;

  if coalesce(sale_paid, 0) + existing_payments + net_paid + new.amount_kes
      > sale_amount + net_revenue then
    raise exception 'Payment cannot exceed the remaining sale balance.';
  end if;
  return new;
end;
$$;

create trigger sale_payments_validate
before insert on public.sale_payments
for each row execute function public.validate_sale_payment();

create function public.create_sale_payment_cash_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_customer text;
  batch_label text;
begin
  if auth.uid() is null
    or new.created_by is distinct from auth.uid()
    or not public.has_farm_role(
      new.farm_id,
      array['owner', 'manager', 'accountant']::public.farm_role[]
    ) then
    raise exception 'You cannot record payments for this farm.';
  end if;

  select s.customer, b.batch_code
    into sale_customer, batch_label
    from public.sales s
    join public.batches b on b.id = s.batch_id and b.farm_id = s.farm_id
    where s.id = new.sale_id and s.farm_id = new.farm_id;
  if not found then
    raise exception 'Sale not found for farm.';
  end if;

  insert into public.cash_entries (
    farm_id, entry_date, details, category, receipt_number,
    money_in_kes, created_by, sale_payment_id
  ) values (
    new.farm_id,
    new.payment_date,
    'Sale payment received: ' || sale_customer || ' (' || batch_label || ')',
    'sale_payment',
    new.reference,
    new.amount_kes,
    new.created_by,
    new.id
  );
  return new;
end;
$$;

create trigger sale_payments_create_cash_entry
after insert on public.sale_payments
for each row execute function public.create_sale_payment_cash_entry();

create function public.guard_sale_payment_cash_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sale_payment_id is not null and pg_trigger_depth() < 2 then
    raise exception 'Payment cashbook entries are created from sale payments.';
  end if;
  return new;
end;
$$;

create trigger cash_entries_sale_payment_insert_guard
before insert on public.cash_entries
for each row execute function public.guard_sale_payment_cash_entry();

create function public.prevent_sale_payment_cash_entry_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sale_payment_id is not null then
    raise exception 'Sale payment cashbook entries are immutable.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger cash_entries_sale_payment_immutable
before update or delete on public.cash_entries
for each row execute function public.prevent_sale_payment_cash_entry_mutation();

create trigger sale_payments_audit
after insert on public.sale_payments
for each row execute function public.write_audit_event();

create function public.create_sale(
  p_farm_id uuid,
  p_batch_id uuid,
  p_sale_date date,
  p_customer text,
  p_birds_sold integer,
  p_total_weight_kg numeric,
  p_price_basis public.sale_price_basis,
  p_price_kes numeric,
  p_paid_kes numeric,
  p_receipt_number text,
  p_remarks text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  inserted_sale public.sales%rowtype;
  initial_payment numeric(12, 2) := coalesce(p_paid_kes, 0);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if initial_payment < 0 then
    raise exception 'Initial payment cannot be negative.';
  end if;

  insert into public.sales (
    farm_id, batch_id, sale_date, customer, birds_sold, total_weight_kg,
    price_basis, price_kes, paid_kes, receipt_number, remarks
  ) values (
    p_farm_id, p_batch_id, p_sale_date, trim(p_customer), p_birds_sold,
    p_total_weight_kg, p_price_basis, p_price_kes, 0, p_receipt_number, p_remarks
  )
  returning * into inserted_sale;

  if initial_payment > 0 then
    insert into public.sale_payments (
      farm_id, sale_id, payment_date, amount_kes, reference, created_by
    ) values (
      p_farm_id, inserted_sale.id, p_sale_date, initial_payment,
      p_receipt_number, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'id', inserted_sale.id,
    'farm_id', inserted_sale.farm_id,
    'batch_id', inserted_sale.batch_id,
    'sale_date', inserted_sale.sale_date,
    'customer', inserted_sale.customer,
    'birds_sold', inserted_sale.birds_sold,
    'total_weight_kg', inserted_sale.total_weight_kg,
    'price_basis', inserted_sale.price_basis,
    'price_kes', inserted_sale.price_kes,
    'amount_kes', inserted_sale.amount_kes,
    'paid_kes', initial_payment,
    'outstanding_kes', inserted_sale.amount_kes - initial_payment,
    'payment_status', case
      when initial_payment >= inserted_sale.amount_kes then 'paid'
      when initial_payment > 0 then 'partial'
      else 'unpaid'
    end,
    'receipt_number', inserted_sale.receipt_number,
    'remarks', inserted_sale.remarks,
    'created_at', inserted_sale.created_at,
    'is_adjustment', false
  );
end;
$$;

revoke all on function public.create_sale(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text
) from public;
grant execute on function public.create_sale(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text
) to authenticated;

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
      select birds_sold, total_weight_kg, amount_kes
        into original_sold, original_weight, original_revenue
        from public.sales
        where id = new.source_record_id and farm_id = new.farm_id and batch_id = new.batch_id;
      if not found then
        raise exception 'Source sale not found in batch';
      end if;

      select coalesce(sum(amount_kes), 0)
        into original_paid
        from public.sale_payments
        where sale_id = new.source_record_id;

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
      select e.money_in_kes, e.money_out_kes
        into original_cash_in, original_cash_out
        from public.cash_entries e
        left join public.sale_payments p on p.id = e.sale_payment_id
        left join public.sales s on s.id = p.sale_id and s.farm_id = p.farm_id
        where e.id = new.source_record_id
          and e.farm_id = new.farm_id
          and (e.batch_id = new.batch_id or s.batch_id = new.batch_id);
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
payment_totals as (
  select s.farm_id, s.batch_id, sum(p.amount_kes) as paid_kes
  from public.sale_payments p
  join public.sales s on s.id = p.sale_id and s.farm_id = p.farm_id
  group by s.farm_id, s.batch_id
),
sale_totals as (
  select s.farm_id, s.batch_id,
         sum(s.birds_sold)::bigint as birds_sold,
         sum(s.total_weight_kg) as live_weight_sold_kg,
         sum(s.amount_kes) as revenue_kes,
         coalesce(max(p.paid_kes), 0) as paid_kes
  from public.sales s
  left join payment_totals p on p.farm_id = s.farm_id and p.batch_id = s.batch_id
  group by s.farm_id, s.batch_id
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
  select s.farm_id, s.batch_id, sum(e.money_in_kes) as cash_in_kes
  from public.cash_entries e
  join public.sale_payments p on p.id = e.sale_payment_id
  join public.sales s on s.id = p.sale_id and s.farm_id = p.farm_id
  group by s.farm_id, s.batch_id
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
         coalesce(ca.cash_in_kes, 0) + coalesce(pc.cash_in_kes, 0)
           + coalesce(c.money_in_kes_delta, 0) as cash_in_kes,
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
  left join payment_cash_totals pc on pc.farm_id = b.farm_id and pc.batch_id = b.id
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
'FCR is feed consumed / live-weight output. Running batches include estimated live flock weight from the latest weight sample; closed batches use total live weight sold. Payment history is authoritative for paid totals, and payment receipts are included in cash-in.';

grant select on public.batch_performance to authenticated;
revoke all on public.batch_performance from anon;

notify pgrst, 'reload schema';
