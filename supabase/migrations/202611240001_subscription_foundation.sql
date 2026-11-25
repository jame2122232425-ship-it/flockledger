create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('starter', 'professional', 'enterprise')),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  trial_days integer not null default 0 check (trial_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  feature_key text not null check (feature_key in (
    'daily_records',
    'feed_tracking',
    'mortality_tracking',
    'weight_tracking',
    'health_management',
    'sales_management',
    'cashbook',
    'inventory_management',
    'staff_management',
    'brooding_management',
    'biosecurity_management',
    'compliance_management',
    'labour_management',
    'maintenance_management',
    'advanced_analytics',
    'data_export',
    'multi_farm_reporting',
    'advanced_reporting',
    'priority_support',
    'max_active_batches',
    'max_staff_users',
    'max_storage_mb'
  )),
  enabled boolean not null default false,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  configuration jsonb not null default '{}'::jsonb
    check (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, feature_key),
  check (
    feature_key in ('max_active_batches', 'max_staff_users', 'max_storage_mb')
    or limit_value is null
  )
);

create table public.subscription_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  currency char(3) not null default 'KES' check (currency = 'KES'),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, billing_interval)
);

create table public.farm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null check (status in (
    'pending', 'trialing', 'active', 'past_due', 'grace_period', 'canceled', 'expired'
  )),
  billing_interval text check (billing_interval in ('monthly', 'annual')),
  started_at timestamptz not null default now(),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, id),
  check (
    (trial_started_at is null and trial_ends_at is null)
    or (trial_started_at is not null and trial_ends_at > trial_started_at)
  ),
  check (
    current_period_end is null
    or current_period_start is null
    or current_period_end > current_period_start
  ),
  check (
    not cancel_at_period_end
    or current_period_end is not null
    or trial_ends_at is not null
  ),
  check (ended_at is null or status in ('canceled', 'expired'))
);

create unique index farm_subscriptions_one_current_per_farm_idx
  on public.farm_subscriptions (farm_id)
  where status in ('pending', 'trialing', 'active', 'past_due', 'grace_period');

create unique index farm_subscriptions_one_trial_per_farm_idx
  on public.farm_subscriptions (farm_id)
  where trial_started_at is not null;

create index farm_subscriptions_farm_history_idx
  on public.farm_subscriptions (farm_id, created_at desc, id desc);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  farm_subscription_id uuid not null,
  farm_id uuid not null references public.farms(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'KES' check (currency = 'KES'),
  provider text not null check (length(trim(provider)) > 0),
  provider_reference text,
  status text not null check (status in ('pending', 'successful', 'failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (farm_id, farm_subscription_id)
    references public.farm_subscriptions(farm_id, id) on delete restrict,
  check ((status = 'successful' and paid_at is not null) or status <> 'successful')
);

create unique index subscription_payments_provider_reference_idx
  on public.subscription_payments (provider, provider_reference)
  where provider_reference is not null;

create index subscription_payments_farm_history_idx
  on public.subscription_payments (farm_id, created_at desc, id desc);

create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  farm_subscription_id uuid not null,
  invoice_number text not null unique,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'KES' check (currency = 'KES'),
  status text not null check (status in ('draft', 'issued', 'paid', 'void', 'overdue')),
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (farm_id, farm_subscription_id)
    references public.farm_subscriptions(farm_id, id) on delete restrict,
  check (due_at is null or issued_at is null or due_at >= issued_at),
  check ((status = 'paid' and paid_at is not null) or status <> 'paid')
);

create index subscription_invoices_farm_history_idx
  on public.subscription_invoices (farm_id, created_at desc, id desc);

create table public.subscription_events (
  id bigint generated always as identity primary key,
  farm_id uuid not null references public.farms(id) on delete restrict,
  farm_subscription_id uuid,
  event_type text not null check (length(trim(event_type)) > 0),
  previous_state jsonb,
  new_state jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (farm_id, farm_subscription_id)
    references public.farm_subscriptions(farm_id, id) on delete restrict
);

create index subscription_events_farm_history_idx
  on public.subscription_events (farm_id, created_at desc, id desc);

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(trim(provider)) > 0),
  provider_event_id text not null check (length(trim(provider_event_id)) > 0),
  event_type text not null check (length(trim(event_type)) > 0),
  processing_status text not null check (
    processing_status in ('processing', 'processed', 'failed')
  ),
  payload_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload_metadata) = 'object'),
  attempt_count integer not null default 1 check (attempt_count > 0),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id),
  check (
    (processing_status = 'processed' and processed_at is not null)
    or processing_status <> 'processed'
  )
);

create table public.subscription_usage (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  farm_subscription_id uuid not null,
  metric_key text not null check (
    metric_key in ('active_batches', 'staff_users', 'storage_mb')
  ),
  usage_value bigint not null check (usage_value >= 0),
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (farm_id, farm_subscription_id)
    references public.farm_subscriptions(farm_id, id) on delete restrict,
  unique (farm_id, farm_subscription_id, metric_key, measured_at)
);

create index subscription_usage_latest_idx
  on public.subscription_usage (
    farm_id, farm_subscription_id, metric_key, measured_at desc
  );

insert into public.subscription_plans (code, name, description, trial_days)
values
  ('starter', 'Starter', 'Free plan for small poultry farms.', 0),
  ('professional', 'Professional', 'Professional plan with a 14-day trial.', 14),
  ('enterprise', 'Enterprise', 'Configurable plan for larger operations.', 0)
on conflict (code) do nothing;

with configured_features(plan_code, feature_key, enabled, limit_value, configuration) as (
  values
    ('starter', 'daily_records', true, null::bigint, '{}'::jsonb),
    ('starter', 'feed_tracking', true, null::bigint, '{}'::jsonb),
    ('starter', 'mortality_tracking', true, null::bigint, '{}'::jsonb),
    ('starter', 'weight_tracking', true, null::bigint, '{}'::jsonb),
    ('starter', 'health_management', true, null::bigint, '{"level":"basic"}'::jsonb),
    ('starter', 'sales_management', true, null::bigint, '{"level":"basic"}'::jsonb),
    ('starter', 'cashbook', true, null::bigint, '{"level":"basic"}'::jsonb),
    ('starter', 'inventory_management', true, null::bigint, '{"level":"basic"}'::jsonb),
    ('starter', 'staff_management', true, null::bigint, '{"level":"basic"}'::jsonb),
    ('starter', 'brooding_management', false, null::bigint, '{}'::jsonb),
    ('starter', 'biosecurity_management', false, null::bigint, '{}'::jsonb),
    ('starter', 'compliance_management', false, null::bigint, '{}'::jsonb),
    ('starter', 'labour_management', false, null::bigint, '{}'::jsonb),
    ('starter', 'maintenance_management', false, null::bigint, '{}'::jsonb),
    ('starter', 'advanced_analytics', false, null::bigint, '{}'::jsonb),
    ('starter', 'data_export', true, null::bigint, '{"level":"basic"}'::jsonb),
    ('starter', 'multi_farm_reporting', false, null::bigint, '{}'::jsonb),
    ('starter', 'advanced_reporting', false, null::bigint, '{}'::jsonb),
    ('starter', 'priority_support', false, null::bigint, '{}'::jsonb),
    ('starter', 'max_active_batches', true, 2, '{}'::jsonb),
    ('starter', 'max_staff_users', true, 2, '{"excludesFarmOwner":true}'::jsonb),
    ('starter', 'max_storage_mb', true, null::bigint, '{}'::jsonb),

    ('professional', 'daily_records', true, null::bigint, '{}'::jsonb),
    ('professional', 'feed_tracking', true, null::bigint, '{}'::jsonb),
    ('professional', 'mortality_tracking', true, null::bigint, '{}'::jsonb),
    ('professional', 'weight_tracking', true, null::bigint, '{}'::jsonb),
    ('professional', 'health_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('professional', 'sales_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('professional', 'cashbook', true, null::bigint, '{"level":"full"}'::jsonb),
    ('professional', 'inventory_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('professional', 'staff_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('professional', 'brooding_management', true, null::bigint, '{}'::jsonb),
    ('professional', 'biosecurity_management', true, null::bigint, '{}'::jsonb),
    ('professional', 'compliance_management', true, null::bigint, '{}'::jsonb),
    ('professional', 'labour_management', true, null::bigint, '{}'::jsonb),
    ('professional', 'maintenance_management', true, null::bigint, '{}'::jsonb),
    ('professional', 'advanced_analytics', true, null::bigint, '{}'::jsonb),
    ('professional', 'data_export', true, null::bigint, '{"level":"full"}'::jsonb),
    ('professional', 'multi_farm_reporting', false, null::bigint, '{}'::jsonb),
    ('professional', 'advanced_reporting', false, null::bigint, '{}'::jsonb),
    ('professional', 'priority_support', false, null::bigint, '{}'::jsonb),
    ('professional', 'max_active_batches', true, 10, '{}'::jsonb),
    ('professional', 'max_staff_users', true, 10, '{"excludesFarmOwner":true}'::jsonb),
    ('professional', 'max_storage_mb', true, null::bigint, '{}'::jsonb),

    ('enterprise', 'daily_records', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'feed_tracking', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'mortality_tracking', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'weight_tracking', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'health_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('enterprise', 'sales_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('enterprise', 'cashbook', true, null::bigint, '{"level":"full"}'::jsonb),
    ('enterprise', 'inventory_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('enterprise', 'staff_management', true, null::bigint, '{"level":"full"}'::jsonb),
    ('enterprise', 'brooding_management', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'biosecurity_management', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'compliance_management', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'labour_management', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'maintenance_management', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'advanced_analytics', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'data_export', true, null::bigint, '{"level":"full"}'::jsonb),
    ('enterprise', 'multi_farm_reporting', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'advanced_reporting', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'priority_support', true, null::bigint, '{}'::jsonb),
    ('enterprise', 'max_active_batches', true, null::bigint, '{"configurable":true}'::jsonb),
    ('enterprise', 'max_staff_users', true, null::bigint, '{"configurable":true,"excludesFarmOwner":true}'::jsonb),
    ('enterprise', 'max_storage_mb', true, null::bigint, '{"configurable":true}'::jsonb)
)
insert into public.plan_features (
  plan_id, feature_key, enabled, limit_value, configuration
)
select p.id, f.feature_key, f.enabled, f.limit_value, f.configuration
from configured_features f
join public.subscription_plans p on p.code = f.plan_code
on conflict (plan_id, feature_key) do nothing;

insert into public.subscription_plan_prices (
  plan_id, billing_interval, currency, amount_minor
)
select p.id, intervals.billing_interval, 'KES',
       case when p.code = 'starter' then 0::bigint else null::bigint end
from public.subscription_plans p
cross join (values ('monthly'), ('annual')) as intervals(billing_interval)
on conflict (plan_id, billing_interval) do nothing;

create or replace function public.create_starter_subscription_for_farm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  starter_plan_id uuid;
  new_subscription_id uuid;
begin
  select id into starter_plan_id
  from public.subscription_plans
  where code = 'starter';
  if starter_plan_id is null then
    raise exception 'Starter subscription plan is not configured.';
  end if;

  insert into public.farm_subscriptions (
    farm_id, plan_id, status, started_at, created_by
  ) values (
    new.id, starter_plan_id, 'active', new.created_at, new.created_by
  )
  returning id into new_subscription_id;

  insert into public.subscription_events (
    farm_id, farm_subscription_id, event_type, new_state, actor_user_id
  ) values (
    new.id,
    new_subscription_id,
    'starter_subscription_created',
    jsonb_build_object('planCode', 'starter', 'status', 'active'),
    new.created_by
  );

  return new;
end;
$$;

revoke all on function public.create_starter_subscription_for_farm() from public;

with starter_plan as (
  select id from public.subscription_plans where code = 'starter'
),
created_subscriptions as (
  insert into public.farm_subscriptions (
    farm_id, plan_id, status, started_at, created_by
  )
  select f.id, p.id, 'active', f.created_at, f.created_by
  from public.farms f
  cross join starter_plan p
  where not exists (
    select 1
    from public.farm_subscriptions s
    where s.farm_id = f.id
      and s.status in ('pending', 'trialing', 'active', 'past_due', 'grace_period')
  )
  returning id, farm_id, created_by
)
insert into public.subscription_events (
  farm_id, farm_subscription_id, event_type, new_state, actor_user_id
)
select
  farm_id,
  id,
  'starter_subscription_created',
  jsonb_build_object('planCode', 'starter', 'status', 'active'),
  created_by
from created_subscriptions;

create trigger farms_create_starter_subscription
after insert on public.farms
for each row execute function public.create_starter_subscription_for_farm();

create or replace function public.get_farm_entitlements(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_subscription public.farm_subscriptions%rowtype;
  effective_plan public.subscription_plans%rowtype;
  starter_plan_id uuid;
  entitlement_now timestamptz := clock_timestamp();
  terminal_status text;
  previous_state jsonb;
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

  select * into current_subscription
  from public.farm_subscriptions s
  where s.farm_id = p_farm_id
    and s.status in ('pending', 'trialing', 'active', 'past_due', 'grace_period')
  for update;

  if not found then
    select id into starter_plan_id
    from public.subscription_plans
    where code = 'starter';

    insert into public.farm_subscriptions (
      farm_id, plan_id, status, started_at, created_by
    ) values (
      p_farm_id, starter_plan_id, 'active', entitlement_now, auth.uid()
    )
    returning * into current_subscription;

    insert into public.subscription_events (
      farm_id, farm_subscription_id, event_type, new_state, actor_user_id
    ) values (
      p_farm_id,
      current_subscription.id,
      'starter_subscription_recovered',
      jsonb_build_object('planCode', 'starter', 'status', 'active'),
      auth.uid()
    );
  else
    terminal_status := null;
    if current_subscription.cancel_at_period_end
      and coalesce(current_subscription.current_period_end, current_subscription.trial_ends_at)
        <= entitlement_now then
      terminal_status := 'canceled';
    elsif current_subscription.status = 'trialing'
      and current_subscription.trial_ends_at <= entitlement_now then
      terminal_status := 'expired';
    elsif current_subscription.status in ('past_due', 'grace_period')
      and current_subscription.current_period_end <= entitlement_now then
      terminal_status := 'expired';
    end if;

    if terminal_status is not null then
      previous_state := jsonb_build_object(
        'planId', current_subscription.plan_id,
        'status', current_subscription.status,
        'cancelAtPeriodEnd', current_subscription.cancel_at_period_end
      );

      update public.farm_subscriptions
      set status = terminal_status,
          canceled_at = case
            when terminal_status = 'canceled' then coalesce(canceled_at, entitlement_now)
            else canceled_at
          end,
          ended_at = entitlement_now,
          updated_at = entitlement_now
      where id = current_subscription.id
      returning * into current_subscription;

      insert into public.subscription_events (
        farm_id, farm_subscription_id, event_type, previous_state, new_state, actor_user_id
      ) values (
        p_farm_id,
        current_subscription.id,
        case when terminal_status = 'expired' then 'subscription_expired' else 'subscription_canceled' end,
        previous_state,
        jsonb_build_object('planId', current_subscription.plan_id, 'status', terminal_status),
        auth.uid()
      );

      select id into starter_plan_id
      from public.subscription_plans
      where code = 'starter';

      insert into public.farm_subscriptions (
        farm_id, plan_id, status, started_at, created_by
      ) values (
        p_farm_id, starter_plan_id, 'active', entitlement_now, auth.uid()
      )
      returning * into current_subscription;

      insert into public.subscription_events (
        farm_id, farm_subscription_id, event_type, new_state, actor_user_id
      ) values (
        p_farm_id,
        current_subscription.id,
        'starter_subscription_created',
        jsonb_build_object('planCode', 'starter', 'status', 'active'),
        auth.uid()
      );
    end if;
  end if;

  if current_subscription.status in ('active', 'trialing', 'grace_period') then
    select * into effective_plan
    from public.subscription_plans
    where id = current_subscription.plan_id;
  else
    select * into effective_plan
    from public.subscription_plans
    where code = 'starter';
  end if;

  return jsonb_build_object(
    'farmId', p_farm_id,
    'subscription', jsonb_build_object(
      'id', current_subscription.id,
      'planCode', (select code from public.subscription_plans where id = current_subscription.plan_id),
      'status', current_subscription.status,
      'billingInterval', current_subscription.billing_interval,
      'startedAt', current_subscription.started_at,
      'trialStartedAt', current_subscription.trial_started_at,
      'trialEndsAt', current_subscription.trial_ends_at,
      'currentPeriodStart', current_subscription.current_period_start,
      'currentPeriodEnd', current_subscription.current_period_end,
      'cancelAtPeriodEnd', current_subscription.cancel_at_period_end,
      'canceledAt', current_subscription.canceled_at,
      'endedAt', current_subscription.ended_at
    ),
    'effectivePlan', jsonb_build_object(
      'code', effective_plan.code,
      'name', effective_plan.name
    ),
    'features',
    coalesce(
      (
        select jsonb_object_agg(
          feature.feature_key,
          jsonb_build_object(
            'enabled', feature.enabled,
            'configuration', feature.configuration
          )
        )
        from public.plan_features feature
        where feature.plan_id = effective_plan.id
          and feature.feature_key not in (
            'max_active_batches', 'max_staff_users', 'max_storage_mb'
          )
      ),
      '{}'::jsonb
    ),
    'limits',
    coalesce(
      (
        select jsonb_object_agg(feature.feature_key, feature.limit_value)
        from public.plan_features feature
        where feature.plan_id = effective_plan.id
          and feature.feature_key in (
            'max_active_batches', 'max_staff_users', 'max_storage_mb'
          )
      ),
      '{}'::jsonb
    ),
    'trialAvailable',
    current_subscription.status = 'active'
    and (select code from public.subscription_plans where id = current_subscription.plan_id) = 'starter'
    and not exists (
      select 1 from public.farm_subscriptions s
      where s.farm_id = p_farm_id and s.trial_started_at is not null
    )
  );
end;
$$;

create or replace function public.start_professional_trial(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  professional_plan_id uuid;
  professional_trial_days integer;
  current_subscription public.farm_subscriptions%rowtype;
  trial_subscription public.farm_subscriptions%rowtype;
  trial_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only a farm owner can start a trial.' using errcode = '42501';
  end if;

  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.farm_subscriptions s
    where s.farm_id = p_farm_id and s.trial_started_at is not null
  ) then
    raise exception 'The Professional trial has already been used for this farm.'
      using errcode = 'P0001';
  end if;

  select * into current_subscription
  from public.farm_subscriptions s
  where s.farm_id = p_farm_id
    and s.status in ('pending', 'trialing', 'active', 'past_due', 'grace_period')
  for update;

  if not found
    or current_subscription.status <> 'active'
    or (select code from public.subscription_plans where id = current_subscription.plan_id) <> 'starter' then
    raise exception 'A trial can only start from an active Starter subscription.'
      using errcode = 'P0001';
  end if;

  select id, trial_days
  into professional_plan_id, professional_trial_days
  from public.subscription_plans
  where code = 'professional' and is_active;
  if professional_plan_id is null or professional_trial_days <= 0 then
    raise exception 'The Professional plan is not available.' using errcode = 'P0001';
  end if;

  update public.farm_subscriptions
  set status = 'expired',
      ended_at = trial_now,
      updated_at = trial_now
  where id = current_subscription.id;

  insert into public.subscription_events (
    farm_id, farm_subscription_id, event_type, previous_state, new_state, actor_user_id
  ) values (
    p_farm_id,
    current_subscription.id,
    'starter_subscription_replaced_by_trial',
    jsonb_build_object('planCode', 'starter', 'status', 'active'),
    jsonb_build_object('status', 'expired'),
    auth.uid()
  );

  insert into public.farm_subscriptions (
    farm_id,
    plan_id,
    status,
    started_at,
    trial_started_at,
    trial_ends_at,
    created_by
  ) values (
    p_farm_id,
    professional_plan_id,
    'trialing',
    trial_now,
    trial_now,
    trial_now + make_interval(days => professional_trial_days),
    auth.uid()
  )
  returning * into trial_subscription;

  insert into public.subscription_events (
    farm_id, farm_subscription_id, event_type, previous_state, new_state, actor_user_id
  ) values (
    p_farm_id,
    trial_subscription.id,
    'professional_trial_started',
    jsonb_build_object('planCode', 'starter', 'status', 'active'),
    jsonb_build_object(
      'planCode', 'professional',
      'status', 'trialing',
      'trialStartedAt', trial_subscription.trial_started_at,
      'trialEndsAt', trial_subscription.trial_ends_at
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'id', trial_subscription.id,
    'farmId', trial_subscription.farm_id,
    'planCode', 'professional',
    'status', trial_subscription.status,
    'trialStartedAt', trial_subscription.trial_started_at,
    'trialEndsAt', trial_subscription.trial_ends_at
  );
end;
$$;

create or replace function public.request_subscription_cancellation(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_subscription public.farm_subscriptions%rowtype;
  cancellation_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.has_farm_role(p_farm_id, array['owner']::public.farm_role[]) then
    raise exception 'Only a farm owner can manage subscription cancellation.'
      using errcode = '42501';
  end if;

  perform 1 from public.farms where id = p_farm_id for update;
  if not found then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  select * into current_subscription
  from public.farm_subscriptions s
  where s.farm_id = p_farm_id
    and s.status in ('pending', 'trialing', 'active', 'past_due', 'grace_period')
  for update;
  if not found then
    raise exception 'No current subscription was found.' using errcode = 'P0001';
  end if;
  if (select code from public.subscription_plans where id = current_subscription.plan_id) = 'starter' then
    raise exception 'The free Starter plan cannot be canceled.' using errcode = 'P0001';
  end if;
  if current_subscription.status not in ('trialing', 'active', 'past_due', 'grace_period') then
    raise exception 'This subscription cannot be canceled in its current state.'
      using errcode = 'P0001';
  end if;
  if coalesce(current_subscription.current_period_end, current_subscription.trial_ends_at) is null then
    raise exception 'The subscription has no scheduled end date.' using errcode = 'P0001';
  end if;

  if not current_subscription.cancel_at_period_end then
    update public.farm_subscriptions
    set cancel_at_period_end = true,
        canceled_at = cancellation_now,
        updated_at = cancellation_now
    where id = current_subscription.id
    returning * into current_subscription;

    insert into public.subscription_events (
      farm_id, farm_subscription_id, event_type, previous_state, new_state, actor_user_id
    ) values (
      p_farm_id,
      current_subscription.id,
      'subscription_cancellation_scheduled',
      jsonb_build_object('cancelAtPeriodEnd', false, 'status', current_subscription.status),
      jsonb_build_object(
        'cancelAtPeriodEnd', true,
        'effectiveAt', coalesce(current_subscription.current_period_end, current_subscription.trial_ends_at)
      ),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'id', current_subscription.id,
    'farmId', current_subscription.farm_id,
    'status', current_subscription.status,
    'cancelAtPeriodEnd', current_subscription.cancel_at_period_end,
    'effectiveAt', coalesce(current_subscription.current_period_end, current_subscription.trial_ends_at)
  );
end;
$$;

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
  next_interval text;
  previous_status text;
  transition_now timestamptz := clock_timestamp();
  transition_allowed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only trusted server operations can change subscription status.'
      using errcode = '42501';
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

  select count(*) into staff_user_count
  from public.farm_memberships
  where farm_id = p_farm_id and role <> 'owner';

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

create or replace function public.claim_payment_webhook_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_payload_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only trusted server operations can claim payment events.'
      using errcode = '42501';
  end if;

  insert into public.payment_webhook_events (
    provider, provider_event_id, event_type, processing_status, payload_metadata
  ) values (
    p_provider, p_provider_event_id, p_event_type, 'processing',
    coalesce(p_payload_metadata, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into claimed_id;

  if claimed_id is not null then
    return true;
  end if;

  update public.payment_webhook_events
  set processing_status = 'processing',
      attempt_count = attempt_count + 1,
      updated_at = clock_timestamp()
  where provider = p_provider
    and provider_event_id = p_provider_event_id
    and processing_status = 'failed'
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

create or replace function public.prevent_subscription_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Subscription events are append-only.';
end;
$$;

create trigger subscription_events_immutable
before update or delete on public.subscription_events
for each row execute function public.prevent_subscription_event_mutation();

revoke all on function public.prevent_subscription_event_mutation() from public;
revoke all on function public.get_farm_entitlements(uuid) from public, anon;
revoke all on function public.start_professional_trial(uuid) from public, anon;
revoke all on function public.request_subscription_cancellation(uuid) from public, anon;
revoke all on function public.transition_subscription_status(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.get_farm_subscription_usage(uuid) from public, anon;
revoke all on function public.claim_payment_webhook_event(text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.get_farm_entitlements(uuid) to authenticated, service_role;
grant execute on function public.start_professional_trial(uuid) to authenticated;
grant execute on function public.request_subscription_cancellation(uuid) to authenticated;
grant execute on function public.transition_subscription_status(uuid, text, uuid, text) to service_role;
grant execute on function public.get_farm_subscription_usage(uuid) to authenticated, service_role;
grant execute on function public.claim_payment_webhook_event(text, text, text, jsonb) to service_role;

alter table public.subscription_plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.subscription_plan_prices enable row level security;
alter table public.farm_subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.subscription_events enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.subscription_usage enable row level security;

create policy subscription_plans_active_read on public.subscription_plans
for select to authenticated using (is_active);

create policy plan_features_active_read on public.plan_features
for select to authenticated using (
  exists (
    select 1 from public.subscription_plans plan
    where plan.id = public.plan_features.plan_id and plan.is_active
  )
);

create policy subscription_plan_prices_active_read on public.subscription_plan_prices
for select to authenticated using (
  exists (
    select 1 from public.subscription_plans plan
    where plan.id = public.subscription_plan_prices.plan_id and plan.is_active
  )
);

create policy farm_subscriptions_owner_read on public.farm_subscriptions
for select to authenticated using (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
);

create policy subscription_payments_owner_read on public.subscription_payments
for select to authenticated using (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
);

create policy subscription_invoices_owner_read on public.subscription_invoices
for select to authenticated using (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
);

create policy subscription_events_owner_read on public.subscription_events
for select to authenticated using (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
);

create policy subscription_usage_owner_read on public.subscription_usage
for select to authenticated using (
  public.has_farm_role(farm_id, array['owner']::public.farm_role[])
);

revoke all on public.subscription_plans, public.plan_features,
  public.subscription_plan_prices, public.farm_subscriptions,
  public.subscription_payments, public.subscription_invoices,
  public.subscription_events, public.payment_webhook_events,
  public.subscription_usage
from anon;

revoke all on public.subscription_plans, public.plan_features,
  public.subscription_plan_prices, public.farm_subscriptions,
  public.subscription_payments, public.subscription_invoices,
  public.subscription_events, public.payment_webhook_events,
  public.subscription_usage
from authenticated;

grant select on public.subscription_plans, public.plan_features,
  public.subscription_plan_prices, public.farm_subscriptions,
  public.subscription_payments, public.subscription_invoices,
  public.subscription_events, public.subscription_usage
to authenticated;

grant all on public.subscription_plans, public.plan_features,
  public.subscription_plan_prices, public.farm_subscriptions,
  public.subscription_payments, public.subscription_invoices,
  public.subscription_events, public.payment_webhook_events,
  public.subscription_usage
to service_role;

notify pgrst, 'reload schema';
