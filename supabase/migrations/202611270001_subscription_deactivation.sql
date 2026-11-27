create table public.subscription_enforcement_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);

insert into public.subscription_enforcement_config (singleton, enabled)
values (true, false);

alter table public.subscription_enforcement_config enable row level security;
revoke all on public.subscription_enforcement_config from public, anon, authenticated;
grant select, update on public.subscription_enforcement_config to service_role;

create function public.subscription_enforcement_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select enabled
     from public.subscription_enforcement_config
     where singleton),
    false
  );
$$;

revoke all on function public.subscription_enforcement_is_enabled()
  from public, anon, authenticated, service_role;

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
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_farm_member(p_farm_id) then
    raise exception 'You cannot access subscriptions for this farm.' using errcode = '42501';
  end if;

  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  if not public.subscription_enforcement_is_enabled() then
    return jsonb_build_object(
      'configured', true,
      'enabled', true,
      'limit', null
    );
  end if;

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

alter function public.get_farm_entitlements(uuid)
  rename to get_farm_entitlements_subscription_enforced;
revoke all on function public.get_farm_entitlements_subscription_enforced(uuid)
  from public, anon, authenticated, service_role;

create function public.get_farm_entitlements(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_farm_member(p_farm_id) then
    raise exception 'You cannot access subscriptions for this farm.' using errcode = '42501';
  end if;
  if not public.subscription_enforcement_is_enabled() then
    raise exception 'Subscription management is temporarily disabled.' using errcode = '55000';
  end if;

  return public.get_farm_entitlements_subscription_enforced(p_farm_id);
end;
$$;

revoke all on function public.get_farm_entitlements(uuid) from public, anon;
grant execute on function public.get_farm_entitlements(uuid) to authenticated, service_role;

alter function public.start_professional_trial(uuid)
  rename to start_professional_trial_subscription_enforced;
revoke all on function public.start_professional_trial_subscription_enforced(uuid)
  from public, anon, authenticated, service_role;

create function public.start_professional_trial(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can start a subscription trial.' using errcode = '42501';
  end if;
  if not public.subscription_enforcement_is_enabled() then
    raise exception 'Subscription management is temporarily disabled.' using errcode = '55000';
  end if;

  return public.start_professional_trial_subscription_enforced(p_farm_id);
end;
$$;

revoke all on function public.start_professional_trial(uuid) from public, anon;
grant execute on function public.start_professional_trial(uuid) to authenticated;

alter function public.request_subscription_cancellation(uuid)
  rename to request_subscription_cancellation_subscription_enforced;
revoke all on function public.request_subscription_cancellation_subscription_enforced(uuid)
  from public, anon, authenticated, service_role;

create function public.request_subscription_cancellation(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only farm owners can request subscription cancellation.' using errcode = '42501';
  end if;
  if not public.subscription_enforcement_is_enabled() then
    raise exception 'Subscription management is temporarily disabled.' using errcode = '55000';
  end if;

  return public.request_subscription_cancellation_subscription_enforced(p_farm_id);
end;
$$;

revoke all on function public.request_subscription_cancellation(uuid) from public, anon;
grant execute on function public.request_subscription_cancellation(uuid) to authenticated;
