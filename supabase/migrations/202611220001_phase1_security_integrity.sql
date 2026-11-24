create table if not exists public.flockledger_idempotency (
  farm_id uuid not null references public.farms(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  payload_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (farm_id, operation, idempotency_key),
  check (length(idempotency_key) between 16 and 128)
);

alter table public.flockledger_idempotency enable row level security;
revoke all on public.flockledger_idempotency from anon, authenticated;

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

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash
  ) values (
    p_farm_id, 'create_sale', p_idempotency_key, p_payload_hash
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_sale'
    and idempotency_key = p_idempotency_key
  for update;

  if existing.payload_hash <> p_payload_hash then
    raise exception 'Idempotency key was already used with different sale data.';
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

  insert into public.flockledger_idempotency (
    farm_id, operation, idempotency_key, payload_hash
  ) values (
    p_farm_id, 'create_sale_payment', p_idempotency_key, p_payload_hash
  ) on conflict (farm_id, operation, idempotency_key) do nothing;

  select * into existing
  from public.flockledger_idempotency
  where farm_id = p_farm_id
    and operation = 'create_sale_payment'
    and idempotency_key = p_idempotency_key
  for update;

  if existing.payload_hash <> p_payload_hash then
    raise exception 'Idempotency key was already used with different payment data.';
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

create or replace function public.consume_staff_setup_token(p_setup_token_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.farm_invitations%rowtype;
  account_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select lower(email) into account_email
  from auth.users
  where id = auth.uid();

  select * into invitation
  from public.farm_invitations
  where setup_token_hash = p_setup_token_hash
    and status = 'pending'
  for update;

  if not found
    or invitation.setup_expires_at is null
    or invitation.setup_expires_at < now()
    or lower(invitation.email) <> account_email then
    raise exception 'This setup link is invalid, expired, or not for this account.';
  end if;

  update public.farm_invitations
  set
    setup_token_hash = null,
    status = 'accepted',
    accepted_at = now()
  where id = invitation.id;

  return invitation.email;
end;
$$;

revoke all on function public.consume_staff_setup_token(text) from public;
grant execute on function public.consume_staff_setup_token(text) to authenticated;

create or replace function public.accept_farm_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted_count integer := 0;
  invitation record;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select lower(email) into user_email
  from auth.users
  where id = auth.uid();

  if user_email is null then
    return 0;
  end if;

  for invitation in
    select *
    from public.farm_invitations
    where status = 'accepted'
      and lower(email) = user_email
      and (setup_expires_at is null or setup_expires_at >= now())
  loop
    insert into public.farm_memberships (farm_id, user_id, role)
    values (invitation.farm_id, auth.uid(), invitation.role)
    on conflict (farm_id, user_id) do nothing;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_farm_invitations() from public;
grant execute on function public.accept_farm_invitations() to authenticated;

create table if not exists public.auth_attempt_limits (
  scope text not null,
  key_hash text not null,
  window_started timestamptz not null default now(),
  attempt_count integer not null default 0,
  primary key (scope, key_hash)
);

alter table public.auth_attempt_limits enable row level security;
revoke all on public.auth_attempt_limits from anon, authenticated;

create or replace function public.check_auth_attempt(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt record;
begin
  select * into attempt
  from public.auth_attempt_limits
  where scope = p_scope and key_hash = p_key_hash
  for update;

  if not found
    or attempt.window_started < now() - make_interval(secs => p_window_seconds) then
    insert into public.auth_attempt_limits (scope, key_hash, window_started, attempt_count)
    values (p_scope, p_key_hash, now(), 0)
    on conflict (scope, key_hash) do update
      set window_started = now(), attempt_count = 0;
    return true;
  end if;

  return attempt.attempt_count < p_limit;
end;
$$;

create or replace function public.record_auth_attempt(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.auth_attempt_limits (scope, key_hash, window_started, attempt_count)
  values (p_scope, p_key_hash, now(), 1)
  on conflict (scope, key_hash) do update
    set attempt_count =
      case
        when auth_attempt_limits.window_started < now() - make_interval(secs => p_window_seconds)
          then 1
        else auth_attempt_limits.attempt_count + 1
      end,
      window_started =
      case
        when auth_attempt_limits.window_started < now() - make_interval(secs => p_window_seconds)
          then now()
        else auth_attempt_limits.window_started
      end;
end;
$$;

revoke all on function public.check_auth_attempt(text, text, integer, integer) from public;
revoke all on function public.record_auth_attempt(text, text, integer) from public;
grant execute on function public.check_auth_attempt(text, text, integer, integer) to anon, authenticated;
grant execute on function public.record_auth_attempt(text, text, integer) to anon, authenticated;
