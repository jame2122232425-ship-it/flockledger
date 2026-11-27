drop function public.create_sale_idempotent(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text, text, text
);

create function public.create_sale_idempotent(
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
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  created jsonb;
  request_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_permission(p_farm_id, 'finance.sales.create') then
    raise exception 'You cannot create sales for this farm.' using errcode = '42501';
  end if;
  if coalesce(p_paid_kes, 0) > 0
    and not public.has_farm_permission(p_farm_id, 'finance.payments.record') then
    raise exception 'You cannot record payments for this farm.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'farmId', p_farm_id, 'batchId', p_batch_id, 'saleDate', p_sale_date,
      'customer', trim(p_customer), 'birdsSold', p_birds_sold,
      'totalWeightKg', p_total_weight_kg, 'priceBasis', p_price_basis,
      'priceKes', p_price_kes, 'paidKes', coalesce(p_paid_kes, 0),
      'receiptNumber', p_receipt_number, 'remarks', p_remarks
    )::text,
    'sha256'
  ), 'hex');

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_sale', p_idempotency_key, request_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_sale'
    and idempotency_key = p_idempotency_key
  for update;
  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> request_hash then
    raise exception 'Idempotency key was already used with different request data.'
      using errcode = 'P0001';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  select public.create_sale(
    p_farm_id, p_batch_id, p_sale_date, p_customer, p_birds_sold,
    p_total_weight_kg, p_price_basis, p_price_kes, coalesce(p_paid_kes, 0),
    p_receipt_number, p_remarks
  ) into created;

  update public.flockledger_idempotency
  set response = created
  where farm_id = p_farm_id
    and operation = 'create_sale'
    and idempotency_key = p_idempotency_key;
  return created;
end;
$$;

drop function public.create_sale_payment_idempotent(
  uuid, uuid, date, numeric, text, text, text
);

create function public.create_sale_payment_idempotent(
  p_farm_id uuid,
  p_sale_id uuid,
  p_payment_date date,
  p_amount_kes numeric,
  p_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  inserted public.sale_payments%rowtype;
  request_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_permission(p_farm_id, 'finance.payments.record') then
    raise exception 'You cannot record payments for this farm.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'farmId', p_farm_id, 'saleId', p_sale_id, 'paymentDate', p_payment_date,
      'amountKes', p_amount_kes, 'reference', p_reference
    )::text,
    'sha256'
  ), 'hex');

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_sale_payment', p_idempotency_key, request_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_sale_payment'
    and idempotency_key = p_idempotency_key
  for update;
  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> request_hash then
    raise exception 'Idempotency key was already used with different request data.'
      using errcode = 'P0001';
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

drop function public.create_cash_entry_idempotent(
  uuid, uuid, date, text, text, text, numeric, numeric, text, text
);

create function public.create_cash_entry_idempotent(
  p_farm_id uuid,
  p_batch_id uuid,
  p_entry_date date,
  p_details text,
  p_category text,
  p_receipt_number text,
  p_money_in_kes numeric,
  p_money_out_kes numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  inserted public.cash_entries%rowtype;
  request_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_permission(p_farm_id, 'finance.cashbook.create') then
    raise exception 'You cannot create cashbook entries for this farm.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'farmId', p_farm_id, 'batchId', p_batch_id, 'entryDate', p_entry_date,
      'details', trim(p_details), 'category', trim(p_category),
      'receiptNumber', p_receipt_number, 'moneyInKes', p_money_in_kes,
      'moneyOutKes', p_money_out_kes
    )::text,
    'sha256'
  ), 'hex');

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_cash_entry', p_idempotency_key, request_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_cash_entry'
    and idempotency_key = p_idempotency_key
  for update;
  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> request_hash then
    raise exception 'Idempotency key was already used with different request data.'
      using errcode = 'P0001';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  insert into public.cash_entries (
    farm_id, batch_id, entry_date, details, category, receipt_number,
    money_in_kes, money_out_kes, created_by
  ) values (
    p_farm_id, p_batch_id, p_entry_date, trim(p_details), trim(p_category),
    p_receipt_number, p_money_in_kes, p_money_out_kes, auth.uid()
  ) returning * into inserted;

  update public.flockledger_idempotency
  set response = to_jsonb(inserted)
  where farm_id = p_farm_id
    and operation = 'create_cash_entry'
    and idempotency_key = p_idempotency_key;
  return to_jsonb(inserted);
end;
$$;

create function public.create_operational_correction_idempotent(
  p_farm_id uuid,
  p_batch_id uuid,
  p_source_record_id uuid,
  p_reason text,
  p_dead_delta integer,
  p_culled_delta integer,
  p_feed_consumed_kg_delta numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.flockledger_idempotency%rowtype;
  inserted public.corrections%rowtype;
  request_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner', 'manager']::public.farm_role[]) then
    raise exception 'Only farm owners or managers can add operational corrections.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;
  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'farmId', p_farm_id, 'batchId', p_batch_id, 'sourceRecordId', p_source_record_id,
      'reason', trim(p_reason), 'deadDelta', p_dead_delta,
      'culledDelta', p_culled_delta, 'feedDelta', p_feed_consumed_kg_delta
    )::text,
    'sha256'
  ), 'hex');

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash, created_by
  ) values (
    p_farm_id, 'create_operational_correction', p_idempotency_key, request_hash, auth.uid()
  ) on conflict (farm_id, operation, idempotency_key) do nothing;
  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_operational_correction'
    and idempotency_key = p_idempotency_key
  for update;
  if existing.created_by is distinct from auth.uid()
    or existing.payload_hash <> request_hash then
    raise exception 'Idempotency key was already used with different request data.'
      using errcode = 'P0001';
  end if;
  if existing.response is not null then
    return existing.response;
  end if;

  insert into public.corrections (
    farm_id, batch_id, source_table, source_record_id, reason,
    dead_delta, culled_delta, feed_consumed_kg_delta, created_by
  ) values (
    p_farm_id, p_batch_id, 'daily_records', p_source_record_id, trim(p_reason),
    p_dead_delta, p_culled_delta, p_feed_consumed_kg_delta, auth.uid()
  ) returning * into inserted;

  update public.flockledger_idempotency
  set response = to_jsonb(inserted)
  where farm_id = p_farm_id
    and operation = 'create_operational_correction'
    and idempotency_key = p_idempotency_key;
  return to_jsonb(inserted);
end;
$$;

create function public.create_financial_correction_request(
  p_farm_id uuid,
  p_correction_kind text,
  p_source_sale_id uuid,
  p_source_payment_id uuid,
  p_source_cash_entry_id uuid,
  p_source_opening_cash_id uuid,
  p_birds_sold_delta integer,
  p_live_weight_sold_kg_delta numeric,
  p_revenue_kes_delta numeric,
  p_amount_kes numeric,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hash text;
  inserted public.financial_correction_requests%rowtype;
  existing public.financial_correction_requests%rowtype;
  source_sale public.sales%rowtype;
  source_payment public.sale_payments%rowtype;
  source_entry public.cash_entries%rowtype;
  paid_total numeric(12, 2);
  refund_total numeric(12, 2);
  revenue_total numeric(12, 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_permission(p_farm_id, 'finance.corrections.initiate') then
    raise exception 'You cannot initiate financial corrections for this farm.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 16 and 128
    or nullif(trim(p_reason), '') is null or length(trim(p_reason)) > 2000 then
    raise exception 'A reason and valid idempotency key are required.' using errcode = '22023';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'farmId', p_farm_id, 'kind', p_correction_kind, 'saleId', p_source_sale_id,
      'paymentId', p_source_payment_id, 'cashEntryId', p_source_cash_entry_id,
      'openingCashId', p_source_opening_cash_id,
      'birdsDelta', p_birds_sold_delta, 'weightDelta', p_live_weight_sold_kg_delta,
      'revenueDelta', p_revenue_kes_delta, 'amount', p_amount_kes,
      'reason', trim(p_reason)
    )::text,
    'sha256'
  ), 'hex');
  select * into existing
  from public.financial_correction_requests
  where farm_id = p_farm_id
    and initiated_by = auth.uid()
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.payload_hash <> request_hash then
      raise exception 'Idempotency key was already used with different correction data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('id', existing.id, 'status', 'pending');
  end if;

  if p_correction_kind = 'sale_adjustment' then
    select * into source_sale from public.sales
    where farm_id = p_farm_id and id = p_source_sale_id for update;
    if not found or p_source_payment_id is not null or p_source_cash_entry_id is not null
      or p_source_opening_cash_id is not null or p_amount_kes is not null
      or (coalesce(p_birds_sold_delta, 0) = 0
        and coalesce(p_live_weight_sold_kg_delta, 0) = 0
        and coalesce(p_revenue_kes_delta, 0) = 0) then
      raise exception 'Invalid sale correction source or amount.' using errcode = '22023';
    end if;
    select coalesce(sum(amount_kes), 0) into paid_total
    from public.sale_payments where farm_id = p_farm_id and sale_id = p_source_sale_id;
    select coalesce(sum(amount_kes), 0) into refund_total
    from public.sale_refunds where farm_id = p_farm_id and sale_id = p_source_sale_id;
    select source_sale.amount_kes
      + coalesce((select sum(adjustment.revenue_kes_delta)
        from public.sale_adjustments adjustment
        where adjustment.farm_id = p_farm_id and adjustment.sale_id = p_source_sale_id), 0)
      + coalesce((select sum(legacy.revenue_kes_delta)
        from public.legacy_financial_reconciliation legacy
        where legacy.farm_id = p_farm_id
          and legacy.source_table = 'sales'
          and legacy.source_record_id = p_source_sale_id), 0)
      + coalesce(p_revenue_kes_delta, 0)
    into revenue_total;
    if source_sale.birds_sold + coalesce((select sum(adjustment.birds_sold_delta)
        from public.sale_adjustments adjustment
        where adjustment.farm_id = p_farm_id and adjustment.sale_id = p_source_sale_id), 0)
        + coalesce(p_birds_sold_delta, 0) < 0
      or source_sale.total_weight_kg + coalesce((select sum(adjustment.live_weight_sold_kg_delta)
        from public.sale_adjustments adjustment
        where adjustment.farm_id = p_farm_id and adjustment.sale_id = p_source_sale_id), 0)
        + coalesce(p_live_weight_sold_kg_delta, 0) < 0
      or revenue_total < 0 or revenue_total < paid_total - refund_total then
      raise exception 'Sale correction would invalidate quantity, revenue, or paid totals.'
        using errcode = '23514';
    end if;
  elsif p_correction_kind = 'payment_refund' then
    select * into source_payment from public.sale_payments
    where farm_id = p_farm_id and id = p_source_payment_id for update;
    if not found or p_source_sale_id is not null or p_source_cash_entry_id is not null
      or p_source_opening_cash_id is not null
      or p_birds_sold_delta <> 0 or p_live_weight_sold_kg_delta <> 0
      or p_revenue_kes_delta <> 0 or p_amount_kes is null or p_amount_kes <= 0 then
      raise exception 'Invalid payment refund source or amount.' using errcode = '22023';
    end if;
    perform 1 from public.sales
    where farm_id = p_farm_id and id = source_payment.sale_id
    for update;
    select coalesce(sum(refund.amount_kes), 0) into refund_total
    from public.sale_refunds refund
    where refund.farm_id = p_farm_id and refund.payment_id = p_source_payment_id;
    if refund_total + p_amount_kes > source_payment.amount_kes then
      raise exception 'Refund exceeds the unrefunded payment amount.' using errcode = '23514';
    end if;
  elsif p_correction_kind = 'cash_entry_reversal' then
    select * into source_entry from public.cash_entries
    where farm_id = p_farm_id and id = p_source_cash_entry_id for update;
    if not found or p_source_sale_id is not null or p_source_payment_id is not null
      or p_source_opening_cash_id is not null
      or p_birds_sold_delta <> 0 or p_live_weight_sold_kg_delta <> 0
      or p_revenue_kes_delta <> 0 or p_amount_kes is null or p_amount_kes <= 0
      or source_entry.sale_payment_id is not null or source_entry.sale_refund_id is not null then
      raise exception 'Invalid cashbook reversal source or amount.' using errcode = '22023';
    end if;
    if p_amount_kes > greatest(source_entry.money_in_kes, source_entry.money_out_kes) then
      raise exception 'Reversal exceeds the original cashbook entry.' using errcode = '23514';
    end if;
    select coalesce(sum(reversal.money_in_kes + reversal.money_out_kes), 0)
      + coalesce((
        select sum(request.amount_kes)
        from public.financial_correction_requests request
        left join public.financial_correction_decisions decision
          on decision.request_id = request.id
        where request.farm_id = p_farm_id
          and request.source_cash_entry_id = p_source_cash_entry_id
          and request.correction_kind = 'cash_entry_reversal'
          and decision.id is null
      ), 0)
    into refund_total
    from public.cash_entries reversal
    where reversal.farm_id = p_farm_id
      and reversal.reverses_cash_entry_id = p_source_cash_entry_id;
    if refund_total + p_amount_kes > greatest(source_entry.money_in_kes, source_entry.money_out_kes) then
      raise exception 'Reversal exceeds the remaining original cashbook amount.' using errcode = '23514';
    end if;
  elsif p_correction_kind = 'opening_cash_adjustment' then
    if p_source_opening_cash_id is null or p_source_sale_id is not null
      or p_source_payment_id is not null or p_source_cash_entry_id is not null
      or p_birds_sold_delta <> 0 or p_live_weight_sold_kg_delta <> 0
      or p_revenue_kes_delta <> 0 or p_amount_kes is null or p_amount_kes = 0
      or not exists (
        select 1 from public.farm_opening_cash_records
        where farm_id = p_farm_id and id = p_source_opening_cash_id
      ) then
      raise exception 'Invalid opening-cash adjustment source or amount.' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported financial correction kind.' using errcode = '22023';
  end if;

  insert into public.financial_correction_requests (
    farm_id, correction_kind, source_sale_id, source_payment_id,
    source_cash_entry_id, source_opening_cash_id, birds_sold_delta,
    live_weight_sold_kg_delta, revenue_kes_delta, amount_kes, reason,
    initiated_by, idempotency_key, payload_hash
  ) values (
    p_farm_id, p_correction_kind, p_source_sale_id, p_source_payment_id,
    p_source_cash_entry_id, p_source_opening_cash_id,
    coalesce(p_birds_sold_delta, 0), coalesce(p_live_weight_sold_kg_delta, 0),
    coalesce(p_revenue_kes_delta, 0), p_amount_kes, trim(p_reason),
    auth.uid(), p_idempotency_key, request_hash
  ) returning * into inserted;
  return jsonb_build_object('id', inserted.id, 'status', 'pending');
end;
$$;

create function public.decide_financial_correction(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.financial_correction_requests%rowtype;
  existing public.financial_correction_decisions%rowtype;
  inserted_decision public.financial_correction_decisions%rowtype;
  source_sale public.sales%rowtype;
  source_payment public.sale_payments%rowtype;
  source_entry public.cash_entries%rowtype;
  effective_revenue numeric(12, 2);
  effective_paid numeric(12, 2);
  prior_refunds numeric(12, 2);
  current_cash numeric(12, 2);
  effect_id uuid;
  request_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected')
    or nullif(trim(p_reason), '') is null
    or length(trim(p_reason)) > 2000
    or p_idempotency_key is null
    or length(trim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'Decision, reason, and valid idempotency key are required.'
      using errcode = '22023';
  end if;

  select * into request
  from public.financial_correction_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  if not public.has_farm_permission(request.farm_id, 'finance.corrections.approve') then
    raise exception 'You cannot decide corrections for this farm.' using errcode = '42501';
  end if;
  if request.initiated_by = auth.uid() then
    raise exception 'The initiator cannot decide their own correction.' using errcode = '42501';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object('requestId', p_request_id, 'decision', p_decision, 'reason', trim(p_reason))::text,
    'sha256'
  ), 'hex');
  select * into existing
  from public.financial_correction_decisions
  where request_id = p_request_id
  for update;
  if found then
    if existing.decided_by = auth.uid()
      and existing.decision = p_decision
      and existing.idempotency_key = p_idempotency_key
      and existing.payload_hash = request_hash then
      return jsonb_build_object('id', existing.id, 'status', existing.decision);
    end if;
    raise exception 'Correction request has already been decided.' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    if request.correction_kind = 'sale_adjustment' then
      select * into source_sale from public.sales
      where farm_id = request.farm_id and id = request.source_sale_id
      for update;
      select source_sale.amount_kes
        + coalesce((select sum(adjustment.revenue_kes_delta)
          from public.sale_adjustments adjustment
          where adjustment.farm_id = request.farm_id
            and adjustment.sale_id = request.source_sale_id), 0)
        + coalesce((select sum(legacy.revenue_kes_delta)
          from public.legacy_financial_reconciliation legacy
          where legacy.farm_id = request.farm_id
            and legacy.source_table = 'sales'
            and legacy.source_record_id = request.source_sale_id), 0)
        + request.revenue_kes_delta
      into effective_revenue;
      select coalesce(sum(payment.amount_kes), 0)
        - coalesce((select sum(refund.amount_kes)
          from public.sale_refunds refund
          where refund.farm_id = request.farm_id
            and refund.sale_id = request.source_sale_id), 0)
      into effective_paid
      from public.sale_payments payment
      where payment.farm_id = request.farm_id and payment.sale_id = request.source_sale_id;
      if effective_revenue < 0 or effective_revenue < effective_paid then
        raise exception 'Approved sale correction would invalidate paid totals.'
          using errcode = '23514';
      end if;
      insert into public.sale_adjustments (
        farm_id, sale_id, correction_request_id, birds_sold_delta,
        live_weight_sold_kg_delta, revenue_kes_delta, created_by
      ) values (
        request.farm_id, request.source_sale_id, request.id,
        request.birds_sold_delta, request.live_weight_sold_kg_delta,
        request.revenue_kes_delta, auth.uid()
      ) returning id into effect_id;
    elsif request.correction_kind = 'payment_refund' then
      select * into source_payment
      from public.sale_payments
      where farm_id = request.farm_id and id = request.source_payment_id
      for update;
      perform 1 from public.sales
      where farm_id = request.farm_id and id = source_payment.sale_id
      for update;
      select coalesce(sum(refund.amount_kes), 0)
        into prior_refunds
      from public.sale_refunds refund
      where refund.farm_id = request.farm_id and refund.payment_id = source_payment.id;
      if prior_refunds + request.amount_kes > source_payment.amount_kes then
        raise exception 'Refund exceeds the unrefunded payment amount.' using errcode = '23514';
      end if;
      insert into public.sale_refunds (
        farm_id, sale_id, payment_id, correction_request_id, refund_date,
        amount_kes, reference, reason, created_by
      ) values (
        request.farm_id, source_payment.sale_id, source_payment.id, request.id,
        current_date, request.amount_kes, null, request.reason, auth.uid()
      ) returning id into effect_id;
    elsif request.correction_kind = 'cash_entry_reversal' then
      select * into source_entry
      from public.cash_entries
      where farm_id = request.farm_id and id = request.source_cash_entry_id
      for update;
      select coalesce(sum(reversal.money_in_kes + reversal.money_out_kes), 0)
        into prior_refunds
      from public.cash_entries reversal
      where reversal.farm_id = request.farm_id
        and reversal.reverses_cash_entry_id = request.source_cash_entry_id;
      if prior_refunds + request.amount_kes
          > greatest(source_entry.money_in_kes, source_entry.money_out_kes) then
        raise exception 'Reversal exceeds the remaining original cashbook amount.'
          using errcode = '23514';
      end if;
      insert into public.cash_entries (
        farm_id, entry_date, details, category, batch_id, receipt_number,
        money_in_kes, money_out_kes, created_by, financial_correction_request_id,
        reverses_cash_entry_id
      ) values (
        request.farm_id, current_date,
        'Approved reversal: ' || request.reason, 'financial_correction',
        source_entry.batch_id, source_entry.receipt_number,
        case when source_entry.money_out_kes > 0 then request.amount_kes else 0 end,
        case when source_entry.money_in_kes > 0 then request.amount_kes else 0 end,
        auth.uid(), request.id, source_entry.id
      ) returning id into effect_id;
    elsif request.correction_kind = 'opening_cash_adjustment' then
      select coalesce(opening.amount_kes, 0)
        + coalesce(sum(entry.money_in_kes - entry.money_out_kes), 0)
      into current_cash
      from public.farm_opening_cash_records opening
      left join public.cash_entries entry on entry.farm_id = opening.farm_id
      where opening.farm_id = request.farm_id
      group by opening.amount_kes;
      if current_cash + request.amount_kes < 0 then
        raise exception 'Opening-cash adjustment would make the farm cash balance negative.'
          using errcode = '23514';
      end if;
      insert into public.cash_entries (
        farm_id, entry_date, details, category, money_in_kes,
        money_out_kes, created_by, financial_correction_request_id
      ) values (
        request.farm_id, current_date,
        'Approved opening-cash adjustment: ' || request.reason,
        'opening_balance_adjustment',
        greatest(request.amount_kes, 0), greatest(-request.amount_kes, 0),
        auth.uid(), request.id
      ) returning id into effect_id;
    end if;
  end if;

  insert into public.financial_correction_decisions (
    farm_id, request_id, decision, decided_by, reason,
    idempotency_key, payload_hash
  ) values (
    request.farm_id, request.id, p_decision, auth.uid(), trim(p_reason),
    p_idempotency_key, request_hash
  ) returning * into inserted_decision;

  return jsonb_build_object(
    'id', inserted_decision.id,
    'status', inserted_decision.decision,
    'effectId', effect_id
  );
end;
$$;

create function public.create_sale_refund_cash_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_name text;
  batch_label text;
begin
  select sale.customer, batch.batch_code
    into customer_name, batch_label
  from public.sales sale
  join public.batches batch
    on batch.id = sale.batch_id and batch.farm_id = sale.farm_id
  where sale.farm_id = new.farm_id and sale.id = new.sale_id;
  if not found then
    raise exception 'Refund sale was not found for farm.' using errcode = '23503';
  end if;
  insert into public.cash_entries (
    farm_id, entry_date, details, category, money_out_kes,
    created_by, sale_refund_id
  ) values (
    new.farm_id, new.refund_date,
    'Sale refund: ' || customer_name || ' (' || batch_label || ')',
    'sale_refund', new.amount_kes, new.created_by, new.id
  );
  return new;
end;
$$;

create or replace function public.create_sale_payment_cash_entry()
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
    or not public.has_farm_permission(new.farm_id, 'finance.payments.record') then
    raise exception 'You cannot record payments for this farm.' using errcode = '42501';
  end if;

  select sale.customer, batch.batch_code
    into sale_customer, batch_label
  from public.sales sale
  join public.batches batch
    on batch.id = sale.batch_id and batch.farm_id = sale.farm_id
  where sale.id = new.sale_id and sale.farm_id = new.farm_id;
  if not found then
    raise exception 'Sale not found for farm.' using errcode = 'P0002';
  end if;

  insert into public.cash_entries (
    farm_id, entry_date, details, category, receipt_number,
    money_in_kes, created_by, sale_payment_id
  ) values (
    new.farm_id, new.payment_date,
    'Sale payment received: ' || sale_customer || ' (' || batch_label || ')',
    'sale_payment', new.reference, new.amount_kes, new.created_by, new.id
  );
  return new;
end;
$$;

create trigger sale_refunds_create_cash_entry
after insert on public.sale_refunds
for each row execute function public.create_sale_refund_cash_entry();

create or replace function public.guard_sale_payment_cash_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.sale_payment_id is not null or new.sale_refund_id is not null)
    and pg_trigger_depth() < 2 then
    raise exception 'Payment and refund cashbook entries are created from their transactions.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_sale_payment_cash_entry_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sale_payment_id is not null or old.sale_refund_id is not null then
    raise exception 'Payment and refund cashbook entries are immutable.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.validate_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_amount numeric(12, 2);
  revenue_adjustments numeric(12, 2);
  existing_payments numeric(12, 2);
  existing_refunds numeric(12, 2);
begin
  if auth.uid() is null
    or new.created_by is distinct from auth.uid()
    or not public.has_farm_permission(new.farm_id, 'finance.payments.record') then
    raise exception 'You cannot record payments for this farm.' using errcode = '42501';
  end if;

  perform 1 from public.batches
  where id = (select batch_id from public.sales where id = new.sale_id and farm_id = new.farm_id)
    and farm_id = new.farm_id
  for update;
  if not found then
    raise exception 'Sale not found for farm.' using errcode = 'P0002';
  end if;
  select sale.amount_kes into sale_amount
  from public.sales sale
  where sale.id = new.sale_id and sale.farm_id = new.farm_id
  for update;
  if not found then
    raise exception 'Sale not found for farm.' using errcode = 'P0002';
  end if;
  select coalesce(sum(adjustment.revenue_kes_delta), 0)
    + coalesce((
      select sum(legacy.revenue_kes_delta)
      from public.legacy_financial_reconciliation legacy
      where legacy.farm_id = new.farm_id
        and legacy.source_table = 'sales'
        and legacy.source_record_id = new.sale_id
    ), 0)
  into revenue_adjustments
  from public.sale_adjustments adjustment
  where adjustment.farm_id = new.farm_id and adjustment.sale_id = new.sale_id;
  select coalesce(sum(amount_kes), 0) into existing_payments
  from public.sale_payments
  where farm_id = new.farm_id and sale_id = new.sale_id;
  select coalesce(sum(amount_kes), 0) into existing_refunds
  from public.sale_refunds
  where farm_id = new.farm_id and sale_id = new.sale_id;
  if existing_payments - existing_refunds + new.amount_kes
      > sale_amount + revenue_adjustments then
    raise exception 'Payment cannot exceed the remaining sale balance.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop function public.create_correction_idempotent(
  uuid, uuid, text, uuid, text, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text
);

create function public.get_financial_correction_requests(
  p_farm_id uuid,
  p_page_size integer default 25,
  p_page_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'data',
      coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc), '[]'::jsonb),
    'total',
      (select count(*) from public.financial_correction_requests request
       where request.farm_id = p_farm_id),
    'hasMore',
      (select count(*) > greatest(0, coalesce(p_page_offset, 0))
        + greatest(1, least(coalesce(p_page_size, 25), 100))
       from public.financial_correction_requests request
       where request.farm_id = p_farm_id)
  )
  from (
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
    where request.farm_id = p_farm_id
    order by request.created_at desc, request.id desc
    limit greatest(1, least(coalesce(p_page_size, 25), 100))
    offset greatest(0, coalesce(p_page_offset, 0))
  ) page_rows;
$$;

revoke all on function public.create_sale_idempotent(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text, text
) from public, anon;
revoke all on function public.create_sale_payment_idempotent(
  uuid, uuid, date, numeric, text, text
) from public, anon;
revoke all on function public.create_cash_entry_idempotent(
  uuid, uuid, date, text, text, text, numeric, numeric, text
) from public, anon;
revoke all on function public.create_operational_correction_idempotent(
  uuid, uuid, uuid, text, integer, integer, numeric, text
) from public, anon;
revoke all on function public.create_financial_correction_request(
  uuid, text, uuid, uuid, uuid, uuid, integer, numeric, numeric, numeric, text, text
) from public, anon;
revoke all on function public.decide_financial_correction(uuid, text, text, text) from public, anon;
revoke all on function public.get_financial_correction_requests(uuid, integer, integer) from public, anon;

grant execute on function public.create_sale_idempotent(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text, text
) to authenticated;
grant execute on function public.create_sale_payment_idempotent(
  uuid, uuid, date, numeric, text, text
) to authenticated;
grant execute on function public.create_cash_entry_idempotent(
  uuid, uuid, date, text, text, text, numeric, numeric, text
) to authenticated;
grant execute on function public.create_operational_correction_idempotent(
  uuid, uuid, uuid, text, integer, integer, numeric, text
) to authenticated;
grant execute on function public.create_financial_correction_request(
  uuid, text, uuid, uuid, uuid, uuid, integer, numeric, numeric, numeric, text, text
) to authenticated;
grant execute on function public.decide_financial_correction(uuid, text, text, text) to authenticated;
grant execute on function public.get_financial_correction_requests(uuid, integer, integer) to authenticated;

revoke all on function public.create_sale(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text
) from public, anon, authenticated;

revoke all on function public.create_sale_payment_cash_entry() from public, anon, authenticated;
revoke all on function public.create_sale_refund_cash_entry() from public, anon, authenticated;
revoke all on function public.validate_sale_payment() from public, anon, authenticated;
revoke all on function public.guard_sale_payment_cash_entry() from public, anon, authenticated;
