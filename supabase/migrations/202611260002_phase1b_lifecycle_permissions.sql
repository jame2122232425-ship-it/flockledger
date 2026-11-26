create type public.farm_lifecycle_status as enum (
  'pending_setup',
  'pending_approval',
  'active',
  'rejected',
  'suspended',
  'archived'
);

alter table public.farms
  add column lifecycle_status public.farm_lifecycle_status not null default 'active';

create table public.platform_administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table public.permission_catalog (
  permission_key text primary key,
  category text not null,
  description text not null
);

create table public.farm_role_permissions (
  role public.farm_role not null,
  permission_key text not null references public.permission_catalog(permission_key) on delete restrict,
  primary key (role, permission_key)
);

insert into public.permission_catalog (permission_key, category, description) values
  ('finance.view', 'finance', 'Read farm financial records and financial summaries.'),
  ('finance.sales.create', 'finance', 'Create sales.'),
  ('finance.payments.record', 'finance', 'Record sale payments.'),
  ('finance.cashbook.create', 'finance', 'Create direct cashbook entries.'),
  ('finance.corrections.initiate', 'finance', 'Initiate financial correction requests.'),
  ('finance.corrections.approve', 'finance', 'Approve or reject financial correction requests.'),
  ('inventory.manage', 'inventory', 'Manage inventory items and stock movements.'),
  ('audit.view.full', 'audit', 'Read all farm audit categories with owner detail.'),
  ('audit.view.operational', 'audit', 'Read operational audit events with redaction.'),
  ('audit.view.financial', 'audit', 'Read financial audit events.'),
  ('audit.view.inventory', 'audit', 'Read inventory audit events with redaction.'),
  ('staff.manage', 'staff', 'Invite staff, assign roles, and deactivate membership.');

insert into public.farm_role_permissions (role, permission_key)
select role_name::public.farm_role, permission_key
from (values
  ('owner', 'finance.view'),
  ('owner', 'finance.sales.create'),
  ('owner', 'finance.payments.record'),
  ('owner', 'finance.cashbook.create'),
  ('owner', 'finance.corrections.initiate'),
  ('owner', 'finance.corrections.approve'),
  ('owner', 'inventory.manage'),
  ('owner', 'audit.view.full'),
  ('owner', 'audit.view.operational'),
  ('owner', 'audit.view.financial'),
  ('owner', 'audit.view.inventory'),
  ('owner', 'staff.manage'),
  ('manager', 'finance.view'),
  ('manager', 'finance.sales.create'),
  ('manager', 'finance.corrections.initiate'),
  ('manager', 'inventory.manage'),
  ('manager', 'audit.view.operational'),
  ('manager', 'audit.view.inventory'),
  ('accountant', 'finance.view'),
  ('accountant', 'finance.sales.create'),
  ('accountant', 'finance.payments.record'),
  ('accountant', 'finance.cashbook.create'),
  ('accountant', 'finance.corrections.initiate'),
  ('accountant', 'audit.view.financial'),
  ('inventory_officer', 'inventory.manage'),
  ('inventory_officer', 'audit.view.inventory')
) as grants(role_name, permission_key);

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = (select auth.uid())
      and administrator.active
  );
$$;

create function public.has_farm_permission(
  target_farm_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_memberships membership
    join public.farms farm on farm.id = membership.farm_id
    join public.farm_role_permissions permission
      on permission.role = membership.role
    where membership.farm_id = target_farm_id
      and membership.user_id = (select auth.uid())
      and farm.lifecycle_status = 'active'
      and permission.permission_key = required_permission
  );
$$;

create table public.farm_onboarding_applications (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in (
    'pending_setup', 'pending_approval', 'approved', 'rejected'
  )),
  farm_name text not null check (length(trim(farm_name)) between 1 and 128),
  opening_cash_balance_kes numeric(12, 2) not null default 0
    check (opening_cash_balance_kes >= 0),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 128),
  payload_hash text not null check (length(payload_hash) = 64),
  invited_by uuid references public.platform_administrators(user_id) on delete restrict,
  source_invitation_id uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.platform_administrators(user_id) on delete restrict,
  decision_reason text,
  unique (owner_user_id, idempotency_key),
  unique (farm_id, id)
);

create unique index farm_onboarding_one_pending_attempt_idx
  on public.farm_onboarding_applications (farm_id)
  where status in ('pending_setup', 'pending_approval');

create table public.farm_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  application_id uuid references public.farm_onboarding_applications(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  from_status public.farm_lifecycle_status,
  to_status public.farm_lifecycle_status not null,
  reason text,
  occurred_at timestamptz not null default now()
);

create table public.platform_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null,
  application_id uuid references public.farm_onboarding_applications(id) on delete restrict,
  farm_id uuid references public.farms(id) on delete restrict,
  reason text,
  details jsonb not null default '{}'::jsonb,
  request_id text,
  occurred_at timestamptz not null default now()
);

create table public.platform_owner_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references public.platform_administrators(user_id) on delete restrict,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email))),
  check (accepted_at is null or accepted_by is not null),
  check (cancelled_at is null or accepted_at is null)
);

create function public.prevent_platform_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Platform audit events are append-only';
end;
$$;

create trigger farm_lifecycle_events_append_only
before update or delete on public.farm_lifecycle_events
for each row execute function public.prevent_platform_audit_mutation();

create trigger platform_audit_events_append_only
before update or delete on public.platform_audit_events
for each row execute function public.prevent_platform_audit_mutation();

alter table public.platform_administrators enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.farm_role_permissions enable row level security;
alter table public.farm_onboarding_applications enable row level security;
alter table public.farm_lifecycle_events enable row level security;
alter table public.platform_audit_events enable row level security;
alter table public.platform_owner_invitations enable row level security;

create policy farm_onboarding_applications_owner_read
on public.farm_onboarding_applications
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on public.platform_administrators,
  public.permission_catalog,
  public.farm_role_permissions,
  public.farm_onboarding_applications,
  public.farm_lifecycle_events,
  public.platform_audit_events,
  public.platform_owner_invitations
from public, anon, authenticated;

grant select on public.farm_onboarding_applications to authenticated;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.has_farm_permission(uuid, text) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_farm_permission(uuid, text) to authenticated;

create or replace function public.create_starter_subscription_for_farm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  starter_plan_id uuid;
  new_subscription_id uuid;
  initial_status text;
  initial_event text;
begin
  select id into starter_plan_id
  from public.subscription_plans
  where code = 'starter';
  if starter_plan_id is null then
    raise exception 'Starter subscription plan is not configured.';
  end if;

  if new.lifecycle_status = 'active' then
    initial_status := 'active';
    initial_event := 'starter_subscription_created';
  else
    initial_status := 'pending';
    initial_event := 'starter_subscription_pending';
  end if;

  insert into public.farm_subscriptions (
    farm_id, plan_id, status, started_at, created_by
  ) values (
    new.id, starter_plan_id, initial_status, new.created_at, new.created_by
  )
  returning id into new_subscription_id;

  insert into public.subscription_events (
    farm_id, farm_subscription_id, event_type, new_state, actor_user_id
  ) values (
    new.id,
    new_subscription_id,
    initial_event,
    jsonb_build_object('planCode', 'starter', 'status', initial_status),
    new.created_by
  );

  return new;
end;
$$;

revoke all on function public.create_starter_subscription_for_farm() from public, anon, authenticated;

create index farm_onboarding_owner_status_idx
  on public.farm_onboarding_applications (owner_user_id, status, created_at desc);
create index farm_lifecycle_events_farm_time_idx
  on public.farm_lifecycle_events (farm_id, occurred_at desc);
create index platform_audit_events_time_idx
  on public.platform_audit_events (occurred_at desc);
