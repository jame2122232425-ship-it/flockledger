alter table public.flockledger_idempotency
  add column if not exists created_by uuid references auth.users(id);

create or replace function public.create_sale_idempotent(
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
  p_remarks text,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  created jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.has_farm_role(
    p_farm_id,
    array['owner', 'manager', 'accountant']::public.farm_role[]
  ) then
    raise exception 'You cannot record sales for this farm.';
  end if;

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_sale', p_idempotency_key, p_payload_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_sale'
    and idempotency_key = p_idempotency_key
  for update;

  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> p_payload_hash then
    raise exception 'Idempotency key was already used with different request data.';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  select public.create_sale(
    p_farm_id,
    p_batch_id,
    p_sale_date,
    p_customer,
    p_birds_sold,
    p_total_weight_kg,
    p_price_basis,
    p_price_kes,
    p_paid_kes,
    p_receipt_number,
    p_remarks
  ) into created;

  update public.flockledger_idempotency
  set response = created
  where farm_id = p_farm_id
    and operation = 'create_sale'
    and idempotency_key = p_idempotency_key;

  return created;
end;
$$;

revoke all on function public.create_sale_idempotent(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text, text, text
) from public;
grant execute on function public.create_sale_idempotent(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text, text, text
) to authenticated;

create or replace function public.create_sale_payment_idempotent(
  p_farm_id uuid,
  p_sale_id uuid,
  p_payment_date date,
  p_amount_kes numeric,
  p_reference text,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  inserted public.sale_payments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.has_farm_role(
    p_farm_id,
    array['owner', 'manager', 'accountant']::public.farm_role[]
  ) then
    raise exception 'You cannot record payments for this farm.';
  end if;

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_sale_payment', p_idempotency_key, p_payload_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_sale_payment'
    and idempotency_key = p_idempotency_key
  for update;

  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> p_payload_hash then
    raise exception 'Idempotency key was already used with different request data.';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  insert into public.sale_payments (
    farm_id, sale_id, payment_date, amount_kes, reference, created_by
  ) values (
    p_farm_id, p_sale_id, p_payment_date, p_amount_kes, p_reference, auth.uid()
  ) returning * into inserted;

  update public.flockledger_idempotency
  set response = to_jsonb(inserted)
  where farm_id = p_farm_id
    and operation = 'create_sale_payment'
    and idempotency_key = p_idempotency_key;

  return to_jsonb(inserted);
end;
$$;

revoke all on function public.create_sale_payment_idempotent(
  uuid, uuid, date, numeric, text, text, text
) from public;
grant execute on function public.create_sale_payment_idempotent(
  uuid, uuid, date, numeric, text, text, text
) to authenticated;

create or replace function public.create_cash_entry_idempotent(
  p_farm_id uuid,
  p_batch_id uuid,
  p_entry_date date,
  p_details text,
  p_category text,
  p_receipt_number text,
  p_money_in_kes numeric,
  p_money_out_kes numeric,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  inserted public.cash_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.has_farm_role(
    p_farm_id,
    array['owner', 'manager', 'accountant']::public.farm_role[]
  ) then
    raise exception 'You cannot add cash entries for this farm.';
  end if;

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_cash_entry', p_idempotency_key, p_payload_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_cash_entry'
    and idempotency_key = p_idempotency_key
  for update;

  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> p_payload_hash then
    raise exception 'Idempotency key was already used with different request data.';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  insert into public.cash_entries (
    farm_id, batch_id, entry_date, details, category, receipt_number,
    money_in_kes, money_out_kes, created_by
  ) values (
    p_farm_id, p_batch_id, p_entry_date, p_details, p_category, p_receipt_number,
    p_money_in_kes, p_money_out_kes, auth.uid()
  ) returning * into inserted;

  update public.flockledger_idempotency
  set response = to_jsonb(inserted)
  where farm_id = p_farm_id
    and operation = 'create_cash_entry'
    and idempotency_key = p_idempotency_key;

  return to_jsonb(inserted);
end;
$$;

revoke all on function public.create_cash_entry_idempotent(
  uuid, uuid, date, text, text, text, numeric, numeric, text, text
) from public;
grant execute on function public.create_cash_entry_idempotent(
  uuid, uuid, date, text, text, text, numeric, numeric, text, text
) to authenticated;

create or replace function public.create_correction_idempotent(
  p_farm_id uuid,
  p_batch_id uuid,
  p_source_table text,
  p_source_record_id uuid,
  p_reason text,
  p_dead_delta integer,
  p_culled_delta integer,
  p_birds_sold_delta integer,
  p_live_weight_sold_kg_delta numeric,
  p_feed_consumed_kg_delta numeric,
  p_revenue_kes_delta numeric,
  p_paid_kes_delta numeric,
  p_money_in_kes_delta numeric,
  p_money_out_kes_delta numeric,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  inserted public.corrections%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.has_farm_role(
    p_farm_id,
    array['owner', 'manager']::public.farm_role[]
  ) then
    raise exception 'Only farm owners or managers can add corrections.';
  end if;

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_correction', p_idempotency_key, p_payload_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_correction'
    and idempotency_key = p_idempotency_key
  for update;

  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> p_payload_hash then
    raise exception 'Idempotency key was already used with different request data.';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  insert into public.corrections (
    farm_id, batch_id, source_table, source_record_id, reason,
    dead_delta, culled_delta, birds_sold_delta, live_weight_sold_kg_delta,
    feed_consumed_kg_delta, revenue_kes_delta, paid_kes_delta,
    money_in_kes_delta, money_out_kes_delta, created_by
  ) values (
    p_farm_id, p_batch_id, p_source_table, p_source_record_id, p_reason,
    p_dead_delta, p_culled_delta, p_birds_sold_delta, p_live_weight_sold_kg_delta,
    p_feed_consumed_kg_delta, p_revenue_kes_delta, p_paid_kes_delta,
    p_money_in_kes_delta, p_money_out_kes_delta, auth.uid()
  ) returning * into inserted;

  update public.flockledger_idempotency
  set response = to_jsonb(inserted)
  where farm_id = p_farm_id
    and operation = 'create_correction'
    and idempotency_key = p_idempotency_key;

  return to_jsonb(inserted);
end;
$$;

revoke all on function public.create_correction_idempotent(
  uuid, uuid, text, uuid, text, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text
) from public;
grant execute on function public.create_correction_idempotent(
  uuid, uuid, text, uuid, text, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text
) to authenticated;

create index if not exists flockledger_idempotency_created_at_idx
  on public.flockledger_idempotency(created_at);
