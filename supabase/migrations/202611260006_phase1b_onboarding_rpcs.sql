alter table public.platform_owner_invitations
  add column idempotency_key text not null,
  add constraint platform_owner_invitation_idempotency_key_check
    check (length(trim(idempotency_key)) between 1 and 128),
  add constraint platform_owner_invitation_idempotency_unique
    unique (invited_by, idempotency_key);

create unique index platform_owner_invitations_email_pending_idx
  on public.platform_owner_invitations (email)
  where accepted_at is null and cancelled_at is null;

create function public.require_verified_onboarding_identity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  verified_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select profile.full_name, user_record.email_confirmed_at
    into profile_name, verified_at
  from public.profiles profile
  join auth.users user_record on user_record.id = profile.id
  where profile.id = (select auth.uid());

  if verified_at is null then
    raise exception 'Verify your email before farm onboarding.' using errcode = '42501';
  end if;
  if nullif(trim(profile_name), '') is null then
    raise exception 'Complete your profile before farm onboarding.' using errcode = '42501';
  end if;
end;
$$;

create function public.create_platform_owner_invitation(
  p_email text,
  p_token_hash text,
  p_idempotency_key text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  existing public.platform_owner_invitations%rowtype;
  inserted public.platform_owner_invitations%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if p_email is null
    or normalized_email = '' or position('@' in normalized_email) < 2
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key is null
    or length(trim(p_idempotency_key)) not between 1 and 128
    or p_expires_at <= now()
    or p_expires_at > now() + interval '14 days' then
    raise exception 'Invalid platform owner invitation.' using errcode = '22023';
  end if;

  update public.platform_owner_invitations
  set cancelled_at = now()
  where email = normalized_email
    and accepted_at is null
    and cancelled_at is null
    and expires_at <= now();

  select * into existing
  from public.platform_owner_invitations
  where invited_by = (select auth.uid())
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.email <> normalized_email or existing.token_hash <> p_token_hash
      or existing.expires_at <> p_expires_at then
      raise exception 'Idempotency key was already used with different invitation data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('id', existing.id, 'expiresAt', existing.expires_at);
  end if;

  insert into public.platform_owner_invitations (
    email, token_hash, invited_by, expires_at, idempotency_key
  ) values (
    normalized_email, p_token_hash, (select auth.uid()), p_expires_at, p_idempotency_key
  )
  returning * into inserted;

  insert into public.platform_audit_events (
    actor_user_id, event_type, details
  ) values (
    (select auth.uid()),
    'platform_owner_invitation_created',
    jsonb_build_object('invitation_id', inserted.id, 'email', normalized_email)
  );
  return jsonb_build_object('id', inserted.id, 'expiresAt', inserted.expires_at);
end;
$$;

create function public.accept_platform_owner_invitation(
  p_invitation_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.platform_owner_invitations%rowtype;
  auth_email text;
  email_verified_at timestamptz;
begin
  perform public.require_verified_onboarding_identity();
  select lower(email), email_confirmed_at
    into auth_email, email_verified_at
  from auth.users
  where id = (select auth.uid());

  if email_verified_at is null then
    raise exception 'Verify your email before accepting this invitation.' using errcode = '42501';
  end if;

  select * into invitation
  from public.platform_owner_invitations
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found.' using errcode = 'P0002';
  end if;
  if invitation.accepted_by = (select auth.uid()) then
    return jsonb_build_object('accepted', true);
  end if;
  if invitation.accepted_at is not null
    or invitation.cancelled_at is not null
    or invitation.expires_at <= now()
    or invitation.email <> auth_email
    or invitation.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex') then
    raise exception 'Invitation is invalid or expired.' using errcode = '42501';
  end if;

  update public.platform_owner_invitations
  set accepted_by = (select auth.uid()), accepted_at = now()
  where id = p_invitation_id;

  insert into public.platform_audit_events (
    actor_user_id, event_type, details
  ) values (
    (select auth.uid()),
    'platform_owner_invitation_accepted',
    jsonb_build_object('invitation_id', p_invitation_id)
  );
  return jsonb_build_object('accepted', true);
end;
$$;

create function public.start_farm_application(
  p_farm_name text,
  p_opening_cash_balance_kes numeric,
  p_idempotency_key text,
  p_invitation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  farm_label text := trim(p_farm_name);
  request_hash text;
  existing public.farm_onboarding_applications%rowtype;
  new_farm_id uuid;
  new_application public.farm_onboarding_applications%rowtype;
begin
  perform public.require_verified_onboarding_identity();
  if p_farm_name is null
    or length(farm_label) not between 1 and 128
    or p_opening_cash_balance_kes is null
    or p_opening_cash_balance_kes < 0
    or p_idempotency_key is null
    or length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Invalid farm application.' using errcode = '22023';
  end if;

  if p_invitation_id is not null and not exists (
    select 1
    from public.platform_owner_invitations invitation
    where invitation.id = p_invitation_id
      and invitation.accepted_by = (select auth.uid())
      and invitation.accepted_at is not null
      and invitation.expires_at > now()
      and invitation.cancelled_at is null
  ) then
    raise exception 'A valid owner invitation is required.' using errcode = '42501';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'farmName', farm_label,
      'openingCashBalanceKes', p_opening_cash_balance_kes,
      'invitationId', p_invitation_id
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || p_idempotency_key));
  select * into existing
  from public.farm_onboarding_applications
  where owner_user_id = (select auth.uid())
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.payload_hash <> request_hash then
      raise exception 'Idempotency key was already used with different application data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'applicationId', existing.id,
      'farmId', existing.farm_id,
      'status', existing.status
    );
  end if;

  insert into public.farms (name, created_by, lifecycle_status)
  values (farm_label, (select auth.uid()), 'pending_setup')
  returning id into new_farm_id;

  insert into public.farm_onboarding_applications (
    farm_id, owner_user_id, status, farm_name, opening_cash_balance_kes,
    idempotency_key, payload_hash, source_invitation_id
  ) values (
    new_farm_id, (select auth.uid()), 'pending_setup', farm_label,
    p_opening_cash_balance_kes, p_idempotency_key, request_hash, p_invitation_id
  )
  returning * into new_application;

  insert into public.farm_opening_cash_records (
    farm_id, application_id, amount_kes, provenance, created_by
  ) values (
    new_farm_id, new_application.id, p_opening_cash_balance_kes, 'new_onboarding',
    (select auth.uid())
  );

  insert into public.farm_lifecycle_events (
    farm_id, application_id, actor_user_id, to_status, reason
  ) values (
    new_farm_id, new_application.id, (select auth.uid()), 'pending_setup',
    'Farm onboarding started.'
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, application_id, farm_id
  ) values (
    (select auth.uid()), 'farm_application_started', new_application.id, new_farm_id
  );

  return jsonb_build_object(
    'applicationId', new_application.id,
    'farmId', new_farm_id,
    'status', new_application.status
  );
end;
$$;

create function public.submit_farm_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.farm_onboarding_applications%rowtype;
  farm_state public.farm_lifecycle_status;
begin
  perform public.require_verified_onboarding_identity();
  select * into application
  from public.farm_onboarding_applications
  where id = p_application_id
    and owner_user_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if application.status = 'pending_approval' then
    return jsonb_build_object('applicationId', application.id, 'status', application.status);
  end if;
  if application.status <> 'pending_setup' then
    raise exception 'Application cannot be submitted from its current state.' using errcode = 'P0001';
  end if;

  select lifecycle_status into farm_state
  from public.farms
  where id = application.farm_id
  for update;
  if farm_state <> 'pending_setup' then
    raise exception 'Farm is not awaiting setup.' using errcode = 'P0001';
  end if;

  update public.farm_onboarding_applications
  set status = 'pending_approval', submitted_at = now()
  where id = application.id;
  update public.farms
  set lifecycle_status = 'pending_approval'
  where id = application.farm_id;

  insert into public.farm_lifecycle_events (
    farm_id, application_id, actor_user_id, from_status, to_status, reason
  ) values (
    application.farm_id, application.id, (select auth.uid()),
    'pending_setup', 'pending_approval', 'Application submitted for review.'
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, application_id, farm_id
  ) values (
    (select auth.uid()), 'farm_application_submitted', application.id, application.farm_id
  );
  return jsonb_build_object('applicationId', application.id, 'status', 'pending_approval');
end;
$$;

create function public.list_platform_farm_applications()
returns table (
  application_id uuid,
  farm_id uuid,
  farm_name text,
  owner_user_id uuid,
  owner_name text,
  owner_email text,
  status text,
  created_at timestamptz,
  submitted_at timestamptz,
  decision_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  return query
  select application.id,
         application.farm_id,
         application.farm_name,
         application.owner_user_id,
         profile.full_name,
         user_record.email,
         application.status,
         application.created_at,
         application.submitted_at,
         application.decision_reason
  from public.farm_onboarding_applications application
  join public.profiles profile on profile.id = application.owner_user_id
  join auth.users user_record on user_record.id = application.owner_user_id
  where application.status in ('pending_setup', 'pending_approval', 'rejected')
  order by application.created_at desc, application.id;
end;
$$;

create function public.approve_farm_application(
  p_application_id uuid,
  p_decision_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.farm_onboarding_applications%rowtype;
  farm_state public.farm_lifecycle_status;
  subscription_id uuid;
  member_role public.farm_role;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if p_decision_reason is not null and length(trim(p_decision_reason)) > 2000 then
    raise exception 'Approval note is too long.' using errcode = '22023';
  end if;
  select * into application
  from public.farm_onboarding_applications
  where id = p_application_id
  for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if application.owner_user_id = (select auth.uid()) then
    raise exception 'An applicant cannot approve their own farm.' using errcode = '42501';
  end if;

  select lifecycle_status into farm_state
  from public.farms
  where id = application.farm_id
  for update;
  if application.status = 'approved' and farm_state = 'active' then
    return jsonb_build_object('farmId', application.farm_id, 'status', 'active');
  end if;
  if application.status <> 'pending_approval' or farm_state <> 'pending_approval' then
    raise exception 'Application is not awaiting approval.' using errcode = 'P0001';
  end if;

  insert into public.farm_memberships (farm_id, user_id, role)
  values (application.farm_id, application.owner_user_id, 'owner')
  on conflict (farm_id, user_id) do nothing;
  select role into member_role
  from public.farm_memberships
  where farm_id = application.farm_id and user_id = application.owner_user_id;
  if member_role is distinct from 'owner'::public.farm_role then
    raise exception 'Existing farm membership is not the expected owner membership.'
      using errcode = '23514';
  end if;

  update public.farms
  set lifecycle_status = 'active'
  where id = application.farm_id;

  update public.farm_subscriptions
  set status = 'active', started_at = now()
  where farm_id = application.farm_id and status = 'pending'
  returning id into subscription_id;
  if subscription_id is null then
    select id into subscription_id
    from public.farm_subscriptions
    where farm_id = application.farm_id and status = 'active';
  end if;
  if subscription_id is null then
    raise exception 'Pending Starter subscription is missing.' using errcode = '23514';
  end if;

  update public.farm_onboarding_applications
  set status = 'approved',
      decided_at = now(),
      decided_by = (select auth.uid()),
      decision_reason = nullif(trim(p_decision_reason), '')
  where id = application.id;

  insert into public.subscription_events (
    farm_id, farm_subscription_id, event_type, previous_state, new_state, actor_user_id
  ) values (
    application.farm_id, subscription_id, 'farm_approved',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'active'),
    (select auth.uid())
  );
  insert into public.farm_lifecycle_events (
    farm_id, application_id, actor_user_id, from_status, to_status, reason
  ) values (
    application.farm_id, application.id, (select auth.uid()),
    'pending_approval', 'active', nullif(trim(p_decision_reason), '')
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, application_id, farm_id, reason
  ) values (
    (select auth.uid()), 'farm_application_approved', application.id,
    application.farm_id, nullif(trim(p_decision_reason), '')
  );

  return jsonb_build_object('farmId', application.farm_id, 'status', 'active');
end;
$$;

create function public.reject_farm_application(
  p_application_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.farm_onboarding_applications%rowtype;
  farm_state public.farm_lifecycle_status;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) > 2000 then
    raise exception 'A rejection reason is required.' using errcode = '22023';
  end if;
  select * into application
  from public.farm_onboarding_applications
  where id = p_application_id
  for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if application.owner_user_id = (select auth.uid()) then
    raise exception 'An applicant cannot reject their own farm.' using errcode = '42501';
  end if;
  select lifecycle_status into farm_state
  from public.farms where id = application.farm_id for update;
  if application.status = 'rejected' and farm_state = 'rejected' then
    return jsonb_build_object('farmId', application.farm_id, 'status', 'rejected');
  end if;
  if application.status <> 'pending_approval' or farm_state <> 'pending_approval' then
    raise exception 'Application is not awaiting a decision.' using errcode = 'P0001';
  end if;

  update public.farm_onboarding_applications
  set status = 'rejected',
      decided_at = now(),
      decided_by = (select auth.uid()),
      decision_reason = trim(p_reason)
  where id = application.id;
  update public.farms
  set lifecycle_status = 'rejected'
  where id = application.farm_id;

  insert into public.farm_lifecycle_events (
    farm_id, application_id, actor_user_id, from_status, to_status, reason
  ) values (
    application.farm_id, application.id, (select auth.uid()),
    'pending_approval', 'rejected', trim(p_reason)
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, application_id, farm_id, reason
  ) values (
    (select auth.uid()), 'farm_application_rejected', application.id,
    application.farm_id, trim(p_reason)
  );
  return jsonb_build_object('farmId', application.farm_id, 'status', 'rejected');
end;
$$;

create function public.reopen_rejected_farm_application(
  p_application_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_application public.farm_onboarding_applications%rowtype;
  new_farm_id uuid;
  new_application public.farm_onboarding_applications%rowtype;
  request_hash text;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;
  select * into old_application
  from public.farm_onboarding_applications
  where id = p_application_id and status = 'rejected'
  for update;
  if not found then
    raise exception 'Rejected application not found.' using errcode = 'P0002';
  end if;

  request_hash := encode(extensions.digest(
    jsonb_build_object('sourceApplicationId', p_application_id)::text,
    'sha256'
  ), 'hex');
  select * into new_application
  from public.farm_onboarding_applications
  where owner_user_id = old_application.owner_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if new_application.payload_hash <> request_hash then
      raise exception 'Idempotency key was already used with different application data.'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'applicationId', new_application.id,
      'farmId', new_application.farm_id,
      'status', new_application.status
    );
  end if;

  insert into public.farms (name, created_by, lifecycle_status)
  values (old_application.farm_name, old_application.owner_user_id, 'pending_setup')
  returning id into new_farm_id;
  insert into public.farm_onboarding_applications (
    farm_id, owner_user_id, status, farm_name, opening_cash_balance_kes,
    idempotency_key, payload_hash, source_invitation_id
  ) values (
    new_farm_id, old_application.owner_user_id, 'pending_setup',
    old_application.farm_name, old_application.opening_cash_balance_kes,
    p_idempotency_key, request_hash, old_application.source_invitation_id
  )
  returning * into new_application;
  insert into public.farm_opening_cash_records (
    farm_id, application_id, amount_kes, provenance, created_by
  ) values (
    new_farm_id, new_application.id, old_application.opening_cash_balance_kes,
    'new_onboarding', old_application.owner_user_id
  );
  insert into public.farm_lifecycle_events (
    farm_id, application_id, actor_user_id, to_status, reason
  ) values (
    new_farm_id, new_application.id, (select auth.uid()), 'pending_setup',
    'New application attempt created after rejection.'
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, application_id, farm_id, reason
  ) values (
    (select auth.uid()), 'farm_application_reopened',
    new_application.id, new_farm_id, 'New application attempt; prior rejection retained.'
  );
  return jsonb_build_object(
    'applicationId', new_application.id,
    'farmId', new_farm_id,
    'status', new_application.status
  );
end;
$$;

create function public.set_farm_suspended(
  p_farm_id uuid,
  p_reason text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  farm_state public.farm_lifecycle_status;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) > 2000 then
    raise exception 'A suspension reason is required.' using errcode = '22023';
  end if;
  select lifecycle_status into farm_state
  from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;
  if farm_state = 'suspended' then
    return jsonb_build_object('farmId', p_farm_id, 'status', 'suspended');
  end if;
  if farm_state <> 'active' then
    raise exception 'Only an active farm can be suspended.' using errcode = 'P0001';
  end if;

  update public.farms set lifecycle_status = 'suspended' where id = p_farm_id;
  insert into public.farm_lifecycle_events (
    farm_id, actor_user_id, from_status, to_status, reason
  ) values (
    p_farm_id, (select auth.uid()), 'active', 'suspended', trim(p_reason)
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, farm_id, reason, request_id
  ) values (
    (select auth.uid()), 'farm_suspended', p_farm_id, trim(p_reason), p_request_id
  );
  return jsonb_build_object('farmId', p_farm_id, 'status', 'suspended');
end;
$$;

create function public.reactivate_suspended_farm(
  p_farm_id uuid,
  p_reason text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  farm_state public.farm_lifecycle_status;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) > 2000 then
    raise exception 'A reactivation reason is required.' using errcode = '22023';
  end if;
  select lifecycle_status into farm_state
  from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;
  if farm_state = 'active' then
    return jsonb_build_object('farmId', p_farm_id, 'status', 'active');
  end if;
  if farm_state <> 'suspended' then
    raise exception 'Only a suspended farm can be reactivated.' using errcode = 'P0001';
  end if;

  update public.farms set lifecycle_status = 'active' where id = p_farm_id;
  insert into public.farm_lifecycle_events (
    farm_id, actor_user_id, from_status, to_status, reason
  ) values (
    p_farm_id, (select auth.uid()), 'suspended', 'active', trim(p_reason)
  );
  insert into public.platform_audit_events (
    actor_user_id, event_type, farm_id, reason, request_id
  ) values (
    (select auth.uid()), 'farm_reactivated', p_farm_id, trim(p_reason), p_request_id
  );
  return jsonb_build_object('farmId', p_farm_id, 'status', 'active');
end;
$$;

revoke all on function public.require_verified_onboarding_identity() from public, anon, authenticated;
revoke all on function public.create_platform_owner_invitation(text, text, text, timestamptz) from public, anon;
revoke all on function public.accept_platform_owner_invitation(uuid, text) from public, anon;
revoke all on function public.start_farm_application(text, numeric, text, uuid) from public, anon;
revoke all on function public.submit_farm_application(uuid) from public, anon;
revoke all on function public.list_platform_farm_applications() from public, anon;
revoke all on function public.approve_farm_application(uuid, text) from public, anon;
revoke all on function public.reject_farm_application(uuid, text) from public, anon;
revoke all on function public.reopen_rejected_farm_application(uuid, text) from public, anon;
revoke all on function public.set_farm_suspended(uuid, text, text) from public, anon;
revoke all on function public.reactivate_suspended_farm(uuid, text, text) from public, anon;

grant execute on function public.accept_platform_owner_invitation(uuid, text) to authenticated;
grant execute on function public.create_platform_owner_invitation(text, text, text, timestamptz) to authenticated;
grant execute on function public.start_farm_application(text, numeric, text, uuid) to authenticated;
grant execute on function public.submit_farm_application(uuid) to authenticated;
grant execute on function public.list_platform_farm_applications() to authenticated;
grant execute on function public.approve_farm_application(uuid, text) to authenticated;
grant execute on function public.reject_farm_application(uuid, text) to authenticated;
grant execute on function public.reopen_rejected_farm_application(uuid, text) to authenticated;
grant execute on function public.set_farm_suspended(uuid, text, text) to authenticated;
grant execute on function public.reactivate_suspended_farm(uuid, text, text) to authenticated;
