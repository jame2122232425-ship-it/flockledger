create table public.farm_staff_seat_reservations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  idempotency_key_hash text not null check (length(idempotency_key_hash) = 64),
  payload_hash text not null check (length(payload_hash) = 64),
  email text not null,
  role public.farm_role not null check (role <> 'owner'),
  full_name text,
  invited_by uuid not null references auth.users(id),
  status text not null default 'reserved'
    check (status in ('reserved', 'provisioned', 'consumed', 'released')),
  auth_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, idempotency_key_hash),
  unique (farm_id, id)
);

create unique index farm_staff_seat_reservations_active_email_key
  on public.farm_staff_seat_reservations (farm_id, lower(email))
  where status in ('reserved', 'provisioned');

create index farm_staff_seat_reservations_expiry_idx
  on public.farm_staff_seat_reservations (farm_id, expires_at)
  where status in ('reserved', 'provisioned');

create trigger farm_staff_seat_reservations_updated_at
before update on public.farm_staff_seat_reservations
for each row execute function public.set_updated_at();

alter table public.farm_staff_seat_reservations enable row level security;
revoke all on public.farm_staff_seat_reservations from anon, authenticated;

alter table public.farm_invitations
  add column reservation_id uuid;

alter table public.farm_invitations
  add constraint farm_invitations_reservation_fkey
  foreign key (farm_id, reservation_id)
  references public.farm_staff_seat_reservations (farm_id, id)
  on delete set null (reservation_id);

create unique index farm_invitations_reservation_id_key
  on public.farm_invitations (reservation_id)
  where reservation_id is not null;

revoke insert on public.batches from authenticated;
revoke insert, update on public.farm_memberships from authenticated;
revoke insert, update on public.farm_invitations from authenticated;

create or replace function public.get_farm_quota_feature(
  p_farm_id uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement_result jsonb;
  feature_row public.plan_features%rowtype;
begin
  entitlement_result := public.get_farm_entitlements(p_farm_id);

  select feature.* into feature_row
  from public.subscription_plans plan
  join public.plan_features feature on feature.plan_id = plan.id
  where plan.code = entitlement_result #>> '{effectivePlan,code}'
    and feature.feature_key = p_feature_key;

  if not found then
    return jsonb_build_object('configured', false);
  end if;

  return jsonb_build_object(
    'configured', true,
    'enabled', feature_row.enabled,
    'limit', feature_row.limit_value
  );
end;
$$;

revoke all on function public.get_farm_quota_feature(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.count_occupied_farm_staff_seats(p_farm_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.farm_memberships membership
      where membership.farm_id = p_farm_id
        and membership.role <> 'owner'
    )
    +
    (
      select count(*)
      from public.farm_staff_seat_reservations reservation
      where reservation.farm_id = p_farm_id
        and reservation.status in ('reserved', 'provisioned')
        and reservation.expires_at > statement_timestamp()
    )
    +
    (
      select count(*)
      from public.farm_invitations invitation
      where invitation.farm_id = p_farm_id
        and invitation.reservation_id is null
        and invitation.status in ('pending', 'accepted')
        and (invitation.setup_expires_at is null or invitation.setup_expires_at >= statement_timestamp())
        and not exists (
          select 1
          from auth.users account
          join public.farm_memberships membership
            on membership.farm_id = invitation.farm_id
            and membership.user_id = account.id
          where lower(account.email) = lower(invitation.email)
        )
    );
$$;

revoke all on function public.count_occupied_farm_staff_seats(uuid) from public, anon, authenticated, service_role;

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
  if not public.has_farm_role(p_farm_id, array['owner', 'manager']::public.farm_role[]) then
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

  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can reserve staff seats.' using errcode = '42501';
  end if;

  update public.farm_staff_seat_reservations
  set status = 'released'
  where farm_id = p_farm_id
    and status in ('reserved', 'provisioned')
    and expires_at <= statement_timestamp();

  update public.farm_invitations invitation
  set status = 'cancelled',
      setup_token_hash = null
  where invitation.farm_id = p_farm_id
    and invitation.reservation_id in (
      select reservation.id
      from public.farm_staff_seat_reservations reservation
      where reservation.farm_id = p_farm_id and reservation.status = 'released'
    )
    and invitation.status in ('pending', 'accepted')
    and invitation.setup_expires_at <= statement_timestamp();

  select * into existing
  from public.farm_staff_seat_reservations
  where farm_id = p_farm_id
    and idempotency_key_hash = p_idempotency_key_hash
  for update;

  if found then
    if existing.payload_hash <> p_payload_hash then
      raise exception 'Idempotency key was already used with different staff invitation data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'reservationId', existing.id,
      'status', existing.status,
      'expiresAt', existing.expires_at,
      'reused', true
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
    select 1
    from public.farm_invitations invitation
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
  returning * into reservation;

  return jsonb_build_object(
    'reservationId', reservation.id,
    'status', reservation.status,
    'expiresAt', reservation.expires_at,
    'reused', false
  );
end;
$$;

revoke all on function public.reserve_farm_staff_seat(
  uuid, text, public.farm_role, text, text, text
) from public, anon;
grant execute on function public.reserve_farm_staff_seat(
  uuid, text, public.farm_role, text, text, text
) to authenticated;

create or replace function public.finalize_farm_staff_invitation(
  p_reservation_id uuid,
  p_auth_user_id uuid,
  p_setup_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.farm_staff_seat_reservations%rowtype;
  invitation public.farm_invitations%rowtype;
  account_email text;
  setup_expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only trusted server operations can finalize staff invitations.'
      using errcode = '42501';
  end if;
  if length(p_setup_token_hash) <> 64 then
    raise exception 'A valid setup token hash is required.' using errcode = '22023';
  end if;

  select * into reservation
  from public.farm_staff_seat_reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception 'Staff seat reservation not found.' using errcode = 'P0002';
  end if;

  if reservation.status in ('provisioned', 'consumed')
    and reservation.auth_user_id = p_auth_user_id then
    select * into invitation
    from public.farm_invitations
    where reservation_id = reservation.id;
    if found then
      return jsonb_build_object(
        'id', invitation.id,
        'email', invitation.email,
        'role', invitation.role,
        'status', invitation.status,
        'created_at', invitation.created_at
      );
    end if;
  end if;

  if reservation.status <> 'reserved'
    or reservation.expires_at <= statement_timestamp() then
    raise exception 'Staff seat reservation is no longer active.' using errcode = 'P0001';
  end if;

  select lower(email) into account_email
  from auth.users
  where id = p_auth_user_id;
  if account_email is null or account_email <> lower(reservation.email) then
    raise exception 'The Auth account does not match the reserved staff email.'
      using errcode = '42501';
  end if;

  setup_expiry := statement_timestamp() + interval '7 days';
  insert into public.farm_invitations (
    farm_id, email, role, invited_by, status, full_name,
    setup_token_hash, setup_expires_at, accepted_at, reservation_id
  ) values (
    reservation.farm_id, reservation.email, reservation.role, reservation.invited_by,
    'pending', reservation.full_name, p_setup_token_hash, setup_expiry, null, reservation.id
  )
  on conflict (farm_id, email) do update
  set role = excluded.role,
      invited_by = excluded.invited_by,
      status = 'pending',
      full_name = excluded.full_name,
      setup_token_hash = excluded.setup_token_hash,
      setup_expires_at = excluded.setup_expires_at,
      accepted_at = null,
      reservation_id = excluded.reservation_id
  returning * into invitation;

  update public.farm_staff_seat_reservations
  set status = 'provisioned',
      auth_user_id = p_auth_user_id,
      expires_at = setup_expiry
  where id = reservation.id;

  return jsonb_build_object(
    'id', invitation.id,
    'email', invitation.email,
    'role', invitation.role,
    'status', invitation.status,
    'created_at', invitation.created_at
  );
end;
$$;

revoke all on function public.finalize_farm_staff_invitation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_farm_staff_invitation(uuid, uuid, text) to service_role;

create or replace function public.release_farm_staff_seat_reservation(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.farm_staff_seat_reservations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only trusted server operations can release staff seat reservations.'
      using errcode = '42501';
  end if;

  select * into reservation
  from public.farm_staff_seat_reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception 'Staff seat reservation not found.' using errcode = 'P0002';
  end if;
  if reservation.status = 'released' then
    return true;
  end if;
  if reservation.status = 'consumed' then
    raise exception 'An accepted staff seat cannot be released as a reservation.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.farm_invitations
    where reservation_id = reservation.id and status = 'accepted'
  ) then
    raise exception 'An accepted setup cannot be released before membership reconciliation.'
      using errcode = 'P0001';
  end if;

  update public.farm_invitations
  set status = 'cancelled',
      setup_token_hash = null
  where reservation_id = reservation.id
    and status = 'pending';

  update public.farm_staff_seat_reservations
  set status = 'released'
  where id = reservation.id;

  return true;
end;
$$;

revoke all on function public.release_farm_staff_seat_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_farm_staff_seat_reservation(uuid) to service_role;

create or replace function public.accept_farm_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted_count integer := 0;
  invitation public.farm_invitations%rowtype;
  user_email text;
  existing_role public.farm_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
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
      and setup_token_hash is null
      and (setup_expires_at is null or setup_expires_at >= statement_timestamp())
    for update
  loop
    perform 1 from public.farms where id = invitation.farm_id for update;

    if invitation.reservation_id is not null then
      perform 1
      from public.farm_staff_seat_reservations reservation
      where reservation.id = invitation.reservation_id
        and reservation.farm_id = invitation.farm_id
        and reservation.status in ('provisioned', 'consumed')
        and reservation.auth_user_id = auth.uid()
        and reservation.expires_at >= statement_timestamp()
      for update;
      if not found then
        raise exception 'The staff seat reservation is invalid or expired.'
          using errcode = 'P0001';
      end if;
    end if;

    select role into existing_role
    from public.farm_memberships
    where farm_id = invitation.farm_id and user_id = auth.uid()
    for update;

    if found and existing_role <> invitation.role then
      raise exception 'The existing farm role does not match this invitation.'
        using errcode = 'P0001';
    end if;
    if not found then
      insert into public.farm_memberships (farm_id, user_id, role)
      values (invitation.farm_id, auth.uid(), invitation.role);
    end if;

    if invitation.reservation_id is not null then
      update public.farm_staff_seat_reservations
      set status = 'consumed'
      where id = invitation.reservation_id
        and status = 'provisioned';
    end if;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_farm_invitations() from public;
grant execute on function public.accept_farm_invitations() to authenticated;

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
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can change member roles.' using errcode = '42501';
  end if;

  select * into current_membership
  from public.farm_memberships
  where farm_id = p_farm_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'Farm member not found.' using errcode = 'P0002';
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

  return to_jsonb(updated_membership);
end;
$$;

revoke all on function public.update_farm_member_role(uuid, uuid, public.farm_role) from public, anon;
grant execute on function public.update_farm_member_role(uuid, uuid, public.farm_role) to authenticated;

create or replace function public.cancel_accepted_invitation_after_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_email text;
begin
  select lower(email) into removed_email
  from auth.users
  where id = old.user_id;

  if removed_email is not null then
    update public.farm_invitations
    set status = 'cancelled',
        setup_token_hash = null
    where farm_id = old.farm_id
      and lower(email) = removed_email
      and reservation_id is not null
      and status = 'accepted';
  end if;
  return old;
end;
$$;

create trigger farm_memberships_cancel_accepted_invitation
after delete on public.farm_memberships
for each row execute function public.cancel_accepted_invitation_after_member_removal();

create or replace function public.transition_subscription_status(
  p_subscription_id uuid,
  p_target_status text,
  p_verified_payment_id uuid default null,
  p_billing_interval text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row public.farm_subscriptions%rowtype;
  target_farm_id uuid;
  next_interval text;
  previous_status text;
  transition_now timestamptz := clock_timestamp();
  transition_allowed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only trusted server operations can change subscription status.'
      using errcode = '42501';
  end if;

  select farm_id into target_farm_id
  from public.farm_subscriptions
  where id = p_subscription_id;
  if not found then
    raise exception 'Subscription not found.' using errcode = 'P0002';
  end if;

  perform 1 from public.farms where id = target_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  select * into subscription_row
  from public.farm_subscriptions s
  where s.id = p_subscription_id
  for update;
  if not found then
    raise exception 'Subscription not found.' using errcode = 'P0002';
  end if;
  previous_status := subscription_row.status;
  if p_target_status not in (
    'pending', 'trialing', 'active', 'past_due', 'grace_period', 'canceled', 'expired'
  ) then
    raise exception 'Invalid subscription status.' using errcode = '22023';
  end if;

  if p_target_status = 'active'
    and subscription_row.status in ('pending', 'trialing', 'past_due', 'grace_period') then
    next_interval := coalesce(p_billing_interval, subscription_row.billing_interval);
    if next_interval is null or next_interval not in ('monthly', 'annual') then
      raise exception 'A paid billing interval is required to activate the subscription.'
        using errcode = 'P0001';
    end if;
    if p_verified_payment_id is null or not exists (
      select 1 from public.subscription_payments payment
      where payment.id = p_verified_payment_id
        and payment.farm_id = subscription_row.farm_id
        and payment.farm_subscription_id = subscription_row.id
        and payment.status = 'successful'
        and payment.paid_at is not null
    ) then
      raise exception 'A verified successful payment is required to activate a paid subscription.'
        using errcode = 'P0001';
    end if;
    transition_allowed := true;
  elsif (subscription_row.status = 'active' and p_target_status = 'past_due')
    or (subscription_row.status = 'past_due' and p_target_status in ('grace_period', 'canceled', 'expired'))
    or (subscription_row.status = 'grace_period' and p_target_status in ('canceled', 'expired'))
    or (subscription_row.status = 'pending' and p_target_status = 'canceled')
    or (
      subscription_row.status = 'trialing'
      and p_target_status = 'expired'
      and subscription_row.trial_ends_at <= transition_now
    ) then
    transition_allowed := true;
  end if;

  if not transition_allowed then
    raise exception 'Invalid subscription status transition: % to %.',
      subscription_row.status, p_target_status
      using errcode = 'P0001';
  end if;

  update public.farm_subscriptions
  set status = p_target_status,
      billing_interval = case when p_target_status = 'active' then next_interval else billing_interval end,
      current_period_start = case when p_target_status = 'active' then transition_now else current_period_start end,
      current_period_end = case
        when p_target_status = 'active' and next_interval = 'monthly'
          then transition_now + interval '1 month'
        when p_target_status = 'active' and next_interval = 'annual'
          then transition_now + interval '1 year'
        else current_period_end
      end,
      canceled_at = case when p_target_status = 'canceled' then coalesce(canceled_at, transition_now) else canceled_at end,
      ended_at = case when p_target_status in ('canceled', 'expired') then transition_now else ended_at end,
      updated_at = transition_now
  where id = subscription_row.id
  returning * into subscription_row;

  insert into public.subscription_events (
    farm_id, farm_subscription_id, event_type, previous_state, new_state
  ) values (
    subscription_row.farm_id,
    subscription_row.id,
    'subscription_status_changed',
    jsonb_build_object('status', previous_status),
    jsonb_build_object('status', subscription_row.status)
  );

  return jsonb_build_object(
    'id', subscription_row.id,
    'farmId', subscription_row.farm_id,
    'status', subscription_row.status,
    'billingInterval', subscription_row.billing_interval,
    'currentPeriodStart', subscription_row.current_period_start,
    'currentPeriodEnd', subscription_row.current_period_end
  );
end;
$$;

create or replace function public.get_farm_subscription_usage(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement_result jsonb;
  current_subscription_id uuid;
  active_batch_count bigint;
  staff_user_count bigint;
  storage_usage bigint;
begin
  if auth.uid() is null or not public.is_farm_member(p_farm_id) then
    raise exception 'You cannot access usage for this farm.' using errcode = '42501';
  end if;

  entitlement_result := public.get_farm_entitlements(p_farm_id);
  current_subscription_id := (entitlement_result #>> '{subscription,id}')::uuid;

  select count(*) into active_batch_count
  from public.batches
  where farm_id = p_farm_id and status = 'running';

  staff_user_count := public.count_occupied_farm_staff_seats(p_farm_id);

  select usage_value into storage_usage
  from public.subscription_usage
  where farm_id = p_farm_id
    and farm_subscription_id = current_subscription_id
    and metric_key = 'storage_mb'
  order by measured_at desc, created_at desc
  limit 1;

  return jsonb_build_object(
    'farmId', p_farm_id,
    'subscriptionId', current_subscription_id,
    'activeBatches', active_batch_count,
    'staffUsers', staff_user_count,
    'storageMb', coalesce(storage_usage, 0)
  );
end;
$$;
