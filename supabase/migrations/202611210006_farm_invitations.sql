create table if not exists public.farm_invitations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  email text not null,
  role public.farm_role not null,
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (farm_id, email)
);

alter table public.farm_invitations
  add column if not exists full_name text,
  add column if not exists setup_token_hash text,
  add column if not exists setup_expires_at timestamptz;

create unique index if not exists farm_invitations_setup_token_hash_key
  on public.farm_invitations(setup_token_hash)
  where setup_token_hash is not null;

alter table public.farm_invitations enable row level security;

drop policy if exists "invitations_owner_read" on public.farm_invitations;
create policy "invitations_owner_read" on public.farm_invitations
  for select to authenticated
  using (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));

drop policy if exists "invitations_owner_insert" on public.farm_invitations;
create policy "invitations_owner_insert" on public.farm_invitations
  for insert to authenticated
  with check (
    public.has_farm_role(farm_id, array['owner']::public.farm_role[])
    and invited_by = auth.uid()
  );

drop policy if exists "invitations_owner_update" on public.farm_invitations;
create policy "invitations_owner_update" on public.farm_invitations
  for update to authenticated
  using (public.has_farm_role(farm_id, array['owner']::public.farm_role[]))
  with check (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));

grant select, insert, update on public.farm_invitations to authenticated;

create or replace function public.accept_farm_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted_count integer := 0;
  invitation record;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select lower(email) into user_email
  from auth.users
  where id = auth.uid();

  if user_email is null then
    return 0;
  end if;

  for invitation in
    select *
    from public.farm_invitations
    where status = 'pending'
      and lower(email) = user_email
  loop
    insert into public.farm_memberships (farm_id, user_id, role)
    values (invitation.farm_id, auth.uid(), invitation.role)
    on conflict (farm_id, user_id) do nothing;

    update public.farm_invitations
    set status = 'accepted', accepted_at = now()
    where id = invitation.id;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_farm_invitations() from public;
grant execute on function public.accept_farm_invitations() to authenticated;
