-- Run only against an approved non-production test database; all fixture writes are rolled back.
begin;
set local session_replication_role = replica;

insert into public.cash_entries (
  id, farm_id, batch_id, entry_date, details, category,
  money_in_kes, money_out_kes, created_by
)
select
  ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  date '2026-01-01' + ((n - 1) % 365),
  'Synthetic pagination benchmark row',
  'benchmark',
  1,
  0,
  'a0000000-0000-4000-8000-000000000001'
from generate_series(1, 10000) as series(n);

do $$
declare
  last_page jsonb;
  empty_page jsonb;
begin
  last_page := public.get_batch_cash_entries_page(
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    100,
    100
  );
  empty_page := public.get_batch_cash_entries_page(
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    101,
    100
  );

  if last_page ->> 'total' <> '10000'
    or jsonb_array_length(last_page -> 'data') <> 100
    or empty_page ->> 'total' <> '10000'
    or jsonb_array_length(empty_page -> 'data') <> 0
  then
    raise exception 'Synthetic 10,000-row pagination benchmark returned an invalid result.';
  end if;
end;
$$;

explain (analyze, buffers, format text)
select public.get_batch_cash_entries_page(
  'f0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  100,
  100
);

rollback;
