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
      select expired_reservation.id
      from public.farm_staff_seat_reservations expired_reservation
      where expired_reservation.farm_id = p_farm_id
        and expired_reservation.status = 'released'
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
