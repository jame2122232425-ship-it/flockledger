create or replace function public.get_farm_professional_trial_history(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  trial_history jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_farm_member(p_farm_id) then
    raise exception 'You cannot access trial history for this farm.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'trialStartedAt', subscription.trial_started_at,
    'trialEndsAt', subscription.trial_ends_at
  )
  into trial_history
  from public.farm_subscriptions subscription
  join public.subscription_plans plan on plan.id = subscription.plan_id
  where subscription.farm_id = p_farm_id
    and plan.code = 'professional'
    and subscription.trial_started_at is not null
  order by subscription.trial_started_at desc, subscription.created_at desc, subscription.id desc
  limit 1;

  return coalesce(
    trial_history,
    jsonb_build_object('trialStartedAt', null, 'trialEndsAt', null)
  );
end;
$$;

revoke all on function public.get_farm_professional_trial_history(uuid)
from public, anon, service_role;
grant execute on function public.get_farm_professional_trial_history(uuid)
to authenticated;

notify pgrst, 'reload schema';
