create or replace function public.has_farm_role(
  target_farm_id uuid,
  allowed_roles public.farm_role[]
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
    where membership.farm_id = target_farm_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (allowed_roles)
      and farm.lifecycle_status = 'active'
  );
$$;

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

revoke all on function public.has_farm_role(uuid, public.farm_role[]) from public, anon;
revoke all on function public.has_farm_permission(uuid, text) from public, anon;
grant execute on function public.has_farm_role(uuid, public.farm_role[]) to authenticated;
grant execute on function public.has_farm_permission(uuid, text) to authenticated;

drop policy sales_member_read on public.sales;
create policy sales_finance_read on public.sales
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

drop policy cash_entries_member_read on public.cash_entries;
create policy cash_entries_finance_read on public.cash_entries
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

drop policy sale_payments_member_read on public.sale_payments;
create policy sale_payments_finance_read on public.sale_payments
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

drop policy corrections_member_read on public.corrections;
create policy corrections_finance_read on public.corrections
for select to authenticated
using (
  public.has_farm_permission(farm_id, 'finance.view')
  or (
    public.is_farm_member(farm_id)
    and revenue_kes_delta = 0
    and paid_kes_delta = 0
    and money_in_kes_delta = 0
    and money_out_kes_delta = 0
  )
);

drop policy audit_events_member_read on public.audit_events;
revoke all on public.audit_events from authenticated;

revoke insert, update, delete on public.sales from authenticated;
grant select on public.sales to authenticated;
revoke insert, update, delete on public.sale_payments from authenticated;
grant select on public.sale_payments to authenticated;
revoke insert, update, delete on public.cash_entries from authenticated;
grant select on public.cash_entries to authenticated;
revoke insert, update, delete on public.corrections from authenticated;
grant select on public.corrections to authenticated;

revoke insert, update, delete on public.financial_correction_requests,
  public.financial_correction_decisions,
  public.sale_adjustments,
  public.sale_refunds,
  public.legacy_financial_reconciliation,
  public.legacy_financial_reconciliation_decisions,
  public.farm_opening_cash_records
from authenticated;

drop policy "memberships_owner_insert" on public.farm_memberships;
drop policy "memberships_owner_update" on public.farm_memberships;
drop policy "memberships_owner_delete" on public.farm_memberships;
drop policy "memberships_member_read" on public.farm_memberships;
create policy memberships_self_or_owner_read on public.farm_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_farm_role(farm_id, array['owner']::public.farm_role[])
);
revoke insert, update, delete on public.farm_memberships from authenticated;
grant select on public.farm_memberships to authenticated;

revoke all on public.farms from authenticated;
grant select (
  id, name, currency, timezone, created_by, created_at, lifecycle_status
) on public.farms to authenticated;
grant update (name, timezone) on public.farms to authenticated;
revoke update (opening_cash_balance_kes, lifecycle_status, created_by, created_at)
  on public.farms from authenticated;

drop policy sales_authorized_insert on public.sales;
drop policy sales_manager_update on public.sales;
drop policy sales_manager_delete on public.sales;
drop policy cash_entries_authorized_insert on public.cash_entries;
drop policy cash_entries_manager_update on public.cash_entries;
drop policy cash_entries_manager_delete on public.cash_entries;
drop policy corrections_authorized_insert on public.corrections;

revoke all on function public.create_farm(text) from public, anon, authenticated;
revoke all on function public.create_farm(text, numeric) from public, anon, authenticated;
revoke all on function public.update_farm_member_role(uuid, uuid, public.farm_role)
  from public, anon;
grant execute on function public.update_farm_member_role(uuid, uuid, public.farm_role)
  to authenticated;

create function public.remove_farm_member(
  p_farm_id uuid,
  p_user_id uuid
)
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
    raise exception 'Only farm owners can remove members.' using errcode = '42501';
  end if;
  delete from public.farm_memberships
  where farm_id = p_farm_id and user_id = p_user_id;
  if not found then
    raise exception 'Farm member not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('removed', true, 'userId', p_user_id);
end;
$$;

revoke all on function public.remove_farm_member(uuid, uuid) from public, anon;
grant execute on function public.remove_farm_member(uuid, uuid) to authenticated;

revoke all on function public.create_sale(
  uuid, uuid, date, text, integer, numeric, public.sale_price_basis,
  numeric, numeric, text, text
) from public, anon, authenticated;

notify pgrst, 'reload schema';
