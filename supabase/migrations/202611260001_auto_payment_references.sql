create function public.assign_sale_payment_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reference is null or pg_catalog.btrim(new.reference) = '' then
    new.reference := 'TMP-MPESA-' || pg_catalog.upper(
      pg_catalog.left(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        10
      )
    );
  end if;
  return new;
end;
$$;

create trigger sale_payments_assign_reference
before insert on public.sale_payments
for each row execute function public.assign_sale_payment_reference();
