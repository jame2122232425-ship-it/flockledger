create or replace function public.cancel_accepted_invitation_after_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_email text;
begin
  select lower(email) into removed_email
  from auth.users
  where id = old.user_id;

  if removed_email is not null then
    update public.farm_invitations
    set status = 'cancelled',
        setup_token_hash = null
    where farm_id = old.farm_id
      and lower(email) = removed_email
      and status = 'accepted';
  end if;
  return old;
end;
$$;
