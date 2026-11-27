create or replace function public.has_farm_permission(
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
      and permission.permission_key = required_permission
      and (
        required_permission not like 'audit.view.%'
        or membership.role = 'owner'
      )
      and (
        farm.lifecycle_status = 'active'
        or (
          farm.lifecycle_status = 'suspended'
          and required_permission in (
            'finance.view',
            'audit.view.full',
            'audit.view.operational',
            'audit.view.financial',
            'audit.view.inventory'
          )
        )
      )
  );
$$;

revoke all on function public.has_farm_permission(uuid, text) from public, anon;
grant execute on function public.has_farm_permission(uuid, text) to authenticated;

notify pgrst, 'reload schema';
