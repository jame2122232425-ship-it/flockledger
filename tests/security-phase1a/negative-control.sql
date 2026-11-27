\set ON_ERROR_STOP on

begin;

create table public.phase1a_intentionally_broken_rls (
  farm_id uuid not null,
  payload text not null
);
alter table public.phase1a_intentionally_broken_rls enable row level security;
create policy phase1a_intentionally_permissive
  on public.phase1a_intentionally_broken_rls
  for select to authenticated using (true);
grant select on public.phase1a_intentionally_broken_rls to authenticated;

insert into public.phase1a_intentionally_broken_rls(farm_id, payload)
values ('20000000-0000-4000-8000-000000000002', 'negative-control');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  if exists (
    select 1
    from public.phase1a_intentionally_broken_rls
    where farm_id = '20000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'DETECTOR_CAUGHT_BROKEN_RLS: cross-tenant row became visible';
  end if;
  raise exception 'NEGATIVE_CONTROL_FAILED: permissive policy was not detected';
end;
$$;

reset role;
rollback;
