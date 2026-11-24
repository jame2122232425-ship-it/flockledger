-- Run only against an approved non-production test database; fixture writes are rolled back.
begin;
set local session_replication_role = replica;

insert into public.sales (
  id, farm_id, batch_id, sale_date, customer, birds_sold, total_weight_kg,
  price_basis, price_kes, created_by
) values
  (
    'c0000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    '2026-01-01', 'Pagination fixture', 1, 1, 'Bird', 10,
    'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000002',
    '2026-01-01', 'Other batch fixture', 1, 1, 'Bird', 10,
    'a0000000-0000-4000-8000-000000000001'
  );

insert into public.sale_payments (
  id, farm_id, sale_id, payment_date, amount_kes, created_by
) values
  (
    'd0000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    '2026-01-06', 1, 'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'd0000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    '2026-01-04', 1, 'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'd0000000-0000-4000-8000-000000000003',
    'f0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    '2026-01-08', 1, 'a0000000-0000-4000-8000-000000000001'
  );

insert into public.cash_entries (
  id, farm_id, batch_id, sale_payment_id, entry_date, details, category,
  money_in_kes, money_out_kes, created_by
) values
  (
    'e0000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    null, '2026-01-05', 'Direct fixture entry', 'test', 1, 0,
    'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'e0000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    null, '2026-01-07', 'Later direct fixture entry', 'test', 1, 0,
    'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'e0000000-0000-4000-8000-000000000003',
    'f0000000-0000-4000-8000-000000000001',
    null, 'd0000000-0000-4000-8000-000000000001',
    '2026-01-06', 'Payment fixture entry', 'sale_payment', 1, 0,
    'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'e0000000-0000-4000-8000-000000000004',
    'f0000000-0000-4000-8000-000000000001',
    null, 'd0000000-0000-4000-8000-000000000002',
    '2026-01-04', 'Earlier payment fixture entry', 'sale_payment', 1, 0,
    'a0000000-0000-4000-8000-000000000001'
  ),
  (
    'e0000000-0000-4000-8000-000000000005',
    'f0000000-0000-4000-8000-000000000001',
    null, 'd0000000-0000-4000-8000-000000000003',
    '2026-01-08', 'Other batch fixture entry', 'sale_payment', 1, 0,
    'a0000000-0000-4000-8000-000000000001'
  );

do $$
declare
  first_page jsonb;
  second_page jsonb;
begin
  first_page := public.get_batch_cash_entries_page(
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    1,
    2
  );
  second_page := public.get_batch_cash_entries_page(
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    2,
    2
  );

  if first_page ->> 'total' <> '4'
    or jsonb_array_length(first_page -> 'data') <> 2
    or first_page -> 'data' -> 0 ->> 'id' <> 'e0000000-0000-4000-8000-000000000002'
    or first_page -> 'data' -> 1 ->> 'id' <> 'e0000000-0000-4000-8000-000000000003'
    or second_page ->> 'total' <> '4'
    or jsonb_array_length(second_page -> 'data') <> 2
    or second_page -> 'data' -> 0 ->> 'id' <> 'e0000000-0000-4000-8000-000000000001'
    or second_page -> 'data' -> 1 ->> 'id' <> 'e0000000-0000-4000-8000-000000000004'
  then
    raise exception 'Batch cash-entry pagination returned an invalid total, order, or page.';
  end if;
end;
$$;

rollback;
