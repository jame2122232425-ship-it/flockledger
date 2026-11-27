\set ON_ERROR_STOP on

-- Run against an isolated Supabase test database with the project migrations applied.
-- The transaction is rolled back; fixture auth users and farms are never retained.
begin;

update public.subscription_enforcement_config
set enabled = true
where singleton;

do $$
begin
  if (select count(*) from public.subscription_plans) <> 3 then
    raise exception 'Expected the three seeded subscription plans.';
  end if;
  if exists (
    select 1
    from public.subscription_plan_prices price
    join public.subscription_plans plan on plan.id = price.plan_id
    where plan.code in ('professional', 'enterprise')
      and price.amount_minor is not null
  ) then
    raise exception 'Paid plan prices must remain unset until approved.';
  end if;
  if (
    select limit_value
    from public.plan_features feature
    join public.subscription_plans plan on plan.id = feature.plan_id
    where plan.code = 'starter' and feature.feature_key = 'max_active_batches'
  ) <> 2 then
    raise exception 'Starter batch limit should be two.';
  end if;
end;
$$;

select gen_random_uuid() as owner_id,
       gen_random_uuid() as second_owner_id,
       gen_random_uuid() as staff_id,
       gen_random_uuid() as farm_id,
       gen_random_uuid() as second_farm_id
\gset

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (:'owner_id'::uuid, 'authenticated', 'authenticated',
   's1-owner-' || :'owner_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  (:'second_owner_id'::uuid, 'authenticated', 'authenticated',
   's1-owner-' || :'second_owner_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  (:'staff_id'::uuid, 'authenticated', 'authenticated',
   's1-staff-' || :'staff_id' || '@example.invalid', 'not-a-login-password',
   clock_timestamp(), '{}'::jsonb, '{}'::jsonb);

insert into public.farms (id, name, created_by)
values
  (:'farm_id'::uuid, 'Subscription S1 test farm', :'owner_id'::uuid),
  (:'second_farm_id'::uuid, 'Subscription S1 isolation farm', :'second_owner_id'::uuid);

insert into public.farm_memberships (farm_id, user_id, role)
values
  (:'farm_id'::uuid, :'owner_id'::uuid, 'owner'),
  (:'farm_id'::uuid, :'staff_id'::uuid, 'attendant'),
  (:'second_farm_id'::uuid, :'second_owner_id'::uuid, 'owner');

select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('flockledger.test.farm_id', :'farm_id', true);
select set_config('flockledger.test.initial_farm_id', :'farm_id', true);
select set_config('flockledger.test.second_farm_id', :'second_farm_id', true);
set local role authenticated;

do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.initial_farm_id')::uuid;
  v_other_farm_id uuid := current_setting('flockledger.test.second_farm_id')::uuid;
  entitlements jsonb;
  trial_result jsonb;
  trial_history jsonb;
  rejected boolean := false;
begin
  if (select count(*) from public.farm_subscriptions s where s.farm_id = v_farm_id) <> 1 then
    raise exception 'New farms must receive exactly one Starter subscription.';
  end if;
  entitlements := public.get_farm_entitlements(v_farm_id);
  if entitlements #>> '{effectivePlan,code}' <> 'starter'
    or entitlements #>> '{limits,max_active_batches}' <> '2'
    or entitlements #>> '{trialAvailable}' <> 'true' then
    raise exception 'Starter entitlements did not match the seeded plan.';
  end if;

  trial_result := public.start_professional_trial(v_farm_id);
  if trial_result ->> 'status' <> 'trialing'
    or trial_result ->> 'planCode' <> 'professional'
    or (trial_result ->> 'trialEndsAt')::timestamptz
      - (trial_result ->> 'trialStartedAt')::timestamptz <> interval '14 days' then
    raise exception 'Professional trial did not have the configured 14-day term.';
  end if;
  trial_history := public.get_farm_professional_trial_history(v_farm_id);
  if (trial_history ->> 'trialStartedAt')::timestamptz
       <> (trial_result ->> 'trialStartedAt')::timestamptz
    or (trial_history ->> 'trialEndsAt')::timestamptz
       <> (trial_result ->> 'trialEndsAt')::timestamptz then
    raise exception 'Active trial history did not preserve the trial dates.';
  end if;

  begin
    perform public.start_professional_trial(v_farm_id);
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A farm must not be able to start a second trial.';
  end if;

  rejected := false;
  begin
    perform public.get_farm_entitlements(v_other_farm_id);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A farm owner must not read another farm subscription.';
  end if;

  rejected := false;
  begin
    perform public.get_farm_professional_trial_history(v_other_farm_id);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A farm owner must not read another farm trial history.';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', :'staff_id', true);
set local role authenticated;

do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  trial_history jsonb;
  rejected boolean := false;
begin
  if public.get_farm_entitlements(v_farm_id) #>> '{effectivePlan,code}' <> 'professional' then
    raise exception 'Farm staff should inherit the farm subscription entitlements.';
  end if;
  trial_history := public.get_farm_professional_trial_history(v_farm_id);
  if trial_history ->> 'trialEndsAt' is null then
    raise exception 'Farm staff should be able to read their farm trial end date.';
  end if;
  begin
    perform public.start_professional_trial(v_farm_id);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Non-owners must not be able to start a trial.';
  end if;
  rejected := false;
  begin
    perform public.request_subscription_cancellation(v_farm_id);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Non-owners must not be able to cancel a subscription.';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', :'owner_id', true);
set local role authenticated;

do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  cancellation jsonb;
  entitlements jsonb;
begin
  cancellation := public.request_subscription_cancellation(v_farm_id);
  if cancellation ->> 'cancelAtPeriodEnd' <> 'true' then
    raise exception 'Cancellation must be scheduled for period end.';
  end if;
  entitlements := public.get_farm_entitlements(v_farm_id);
  if entitlements #>> '{effectivePlan,code}' <> 'professional'
    or entitlements #>> '{subscription,cancelAtPeriodEnd}' <> 'true' then
    raise exception 'Scheduled cancellation must keep Professional entitlements until expiry.';
  end if;
end;
$$;

reset role;
update public.farm_subscriptions
set trial_started_at = clock_timestamp() - interval '15 days',
    trial_ends_at = clock_timestamp() - interval '1 day'
where farm_id = :'farm_id'::uuid and status = 'trialing';

select set_config('request.jwt.claim.sub', :'owner_id', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  entitlements jsonb;
  trial_history jsonb;
  rejected boolean := false;
begin
  entitlements := public.get_farm_entitlements(v_farm_id);
  if entitlements #>> '{effectivePlan,code}' <> 'starter'
    or entitlements #>> '{subscription,planCode}' <> 'starter'
    or entitlements #>> '{subscription,status}' <> 'active'
    or entitlements #>> '{subscription,cancelAtPeriodEnd}' <> 'false' then
    raise exception 'A canceled trial must fall back to Starter at the trial end.';
  end if;
  trial_history := public.get_farm_professional_trial_history(v_farm_id);
  if trial_history ->> 'trialEndsAt' is null
    or (trial_history ->> 'trialEndsAt')::timestamptz >= clock_timestamp()
    or entitlements #>> '{trialAvailable}' <> 'false' then
    raise exception 'Expired trial history and used-trial state must survive the Starter fallback.';
  end if;
  begin
    perform public.start_professional_trial(v_farm_id);
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'An expired, previously used trial must not be reactivated.';
  end if;
  if not exists (
    select 1
    from public.farm_subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.farm_id = v_farm_id
      and p.code = 'professional'
      and s.status = 'canceled'
  ) then
    raise exception 'The canceled Professional trial must remain in subscription history.';
  end if;
  if not exists (select 1 from public.farms f where f.id = v_farm_id)
    or not exists (
      select 1 from public.farm_memberships m
      where m.farm_id = v_farm_id and m.role = 'owner'
    ) then
    raise exception 'Trial expiry must preserve the farm and its membership.';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', :'second_owner_id', true);
select set_config('flockledger.test.farm_id', :'second_farm_id', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
begin
  perform public.start_professional_trial(v_farm_id);
end;
$$;

reset role;
update public.farm_subscriptions
set trial_started_at = clock_timestamp() - interval '15 days',
    trial_ends_at = clock_timestamp() - interval '1 day'
where farm_id = :'second_farm_id'::uuid and status = 'trialing';

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  trial_history jsonb;
  rejected boolean := false;
begin
  if public.get_farm_entitlements(v_farm_id) #>> '{effectivePlan,code}' <> 'starter' then
    raise exception 'An expired, non-canceled trial must fall back to Starter.';
  end if;
  trial_history := public.get_farm_professional_trial_history(v_farm_id);
  if trial_history ->> 'trialEndsAt' is null
    or (trial_history ->> 'trialEndsAt')::timestamptz >= clock_timestamp() then
    raise exception 'Expired trial end date must remain available in history.';
  end if;
  begin
    perform public.start_professional_trial(v_farm_id);
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'An expired trial must not be reactivated.';
  end if;
  if not exists (
    select 1
    from public.farm_subscriptions subscription
    join public.subscription_plans plan on plan.id = subscription.plan_id
    where subscription.farm_id = v_farm_id
      and plan.code = 'professional'
      and subscription.status = 'expired'
      and subscription.trial_ends_at = (trial_history ->> 'trialEndsAt')::timestamptz
  ) then
    raise exception 'Expired Professional subscription history must remain stored.';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.farm_id')::uuid;
  professional_plan_id uuid;
  pending_subscription_id uuid;
  payment_id uuid;
  rejected boolean := false;
begin
  select id into professional_plan_id
  from public.subscription_plans where code = 'professional';
  update public.farm_subscriptions
  set status = 'expired', ended_at = clock_timestamp()
  where farm_subscriptions.farm_id = v_farm_id and status = 'active';

  insert into public.farm_subscriptions (
    farm_id, plan_id, status, created_by
  ) values (
    v_farm_id, professional_plan_id, 'pending',
    current_setting('request.jwt.claim.sub')::uuid
  )
  returning id into pending_subscription_id;

  begin
    perform public.transition_subscription_status(
      pending_subscription_id, 'active', null, 'monthly'
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Paid activation must require a successful payment.';
  end if;

  insert into public.subscription_payments (
    farm_subscription_id, farm_id, amount_minor, provider,
    provider_reference, status, paid_at
  ) values (
    pending_subscription_id, v_farm_id, 100, 'test-provider',
    's1-payment-' || pending_subscription_id, 'successful', clock_timestamp()
  )
  returning id into payment_id;

  rejected := false;
  begin
    insert into public.subscription_payments (
      farm_subscription_id, farm_id, amount_minor, provider,
      provider_reference, status
    ) values (
      pending_subscription_id, v_farm_id, 100, 'test-provider',
      's1-payment-' || pending_subscription_id, 'pending'
    );
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A provider payment reference must be unique.';
  end if;

  rejected := false;
  begin
    perform public.transition_subscription_status(
      pending_subscription_id, 'active', payment_id, null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Paid activation must require a valid billing interval.';
  end if;

  perform public.transition_subscription_status(
    pending_subscription_id, 'active', payment_id, 'monthly'
  );
  if (select status from public.farm_subscriptions
      where id = pending_subscription_id) <> 'active' then
    raise exception 'Verified payment did not activate the subscription.';
  end if;

  if not public.claim_payment_webhook_event(
    'test-provider', 's1-event-' || pending_subscription_id, 'payment.succeeded'
  ) then
    raise exception 'The first webhook event claim should succeed.';
  end if;
  if public.claim_payment_webhook_event(
    'test-provider', 's1-event-' || pending_subscription_id, 'payment.succeeded'
  ) then
    raise exception 'A duplicate webhook event must not be claimed twice.';
  end if;

  rejected := false;
  begin
    update public.subscription_events
    set metadata = metadata
    where farm_id = v_farm_id and event_type = 'subscription_status_changed';
  exception when raise_exception then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Subscription event history must be immutable.';
  end if;
end;
$$;

reset role;
set local role anon;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.initial_farm_id')::uuid;
  rejected boolean := false;
begin
  begin
    perform public.get_farm_professional_trial_history(v_farm_id);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Anonymous users must not read farm trial history.';
  end if;
end;
$$;

reset role;
set local role service_role;
do $$
declare
  v_farm_id uuid := current_setting('flockledger.test.initial_farm_id')::uuid;
  rejected boolean := false;
begin
  begin
    delete from public.farm_subscriptions s
    using public.subscription_plans p
    where s.plan_id = p.id
      and s.farm_id = v_farm_id
      and p.code = 'professional'
      and s.status = 'canceled';
  exception when restrict_violation or foreign_key_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Subscription deletion must not cascade away append-only event history.';
  end if;
end;
$$;

rollback;
