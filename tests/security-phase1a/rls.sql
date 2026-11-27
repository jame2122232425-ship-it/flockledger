\set ON_ERROR_STOP on

begin;

create temp table phase1a_assertions (name text primary key) on commit drop;
grant all on phase1a_assertions to authenticated, anon;

create function pg_temp.assert_true(p_ok boolean, p_name text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_name;
  end if;
  insert into phase1a_assertions(name) values (p_name);
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-b@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'manager-a@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'accountant-a@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'attendant-a@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'veterinarian-a@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'inventory-a@example.invalid', 'test-only', clock_timestamp(), '{}'::jsonb, '{}'::jsonb);

insert into public.farms (id, name, created_by)
values
  ('20000000-0000-4000-8000-000000000001', 'Farm A security fixture', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Farm B security fixture', '10000000-0000-4000-8000-000000000002');

insert into public.farm_memberships (farm_id, user_id, role)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'manager'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'accountant'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'attendant'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'veterinarian'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007', 'inventory_officer');

insert into public.batches (
  id, farm_id, batch_code, batch_type, house, date_placed,
  chicks_ordered, chicks_received, status, created_by
) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'P1A-A-1', 'Broiler', 'A1', '2026-01-01', 100, 100, 'running', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'P1A-B-1', 'Broiler', 'B1', '2026-01-01', 100, 100, 'running', '10000000-0000-4000-8000-000000000002');

insert into public.daily_records (
  farm_id, batch_id, record_date, dead, culled, feed_given_kg, feed_left_kg,
  water_liters, created_by
) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2026-01-02', 1, 0, 40, 5, 80, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '2026-01-02', 1, 0, 40, 5, 80, '10000000-0000-4000-8000-000000000002');

insert into public.inventory_items (
  id, farm_id, name, item_type, unit, reorder_level, created_at
) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Starter feed A', 'feed', 'kg', 10, clock_timestamp()),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Starter feed B', 'feed', 'kg', 10, clock_timestamp());

insert into public.stock_movements (
  farm_id, item_id, batch_id, movement_date, received, used, created_by
) values
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2026-01-02', 100, 0, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '2026-01-02', 100, 0, '10000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.weight_records (
  farm_id, batch_id, record_date, age_days, birds_weighed,
  total_weight_g, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-03', 2, 10, 5000,
  '10000000-0000-4000-8000-000000000002'
);

insert into public.feed_deliveries (
  farm_id, batch_id, delivery_date, feed_type, bags,
  kg_per_bag, price_per_bag, supplier, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-03', 'Grower', 10, 50, 3200,
  'Fixture supplier', '10000000-0000-4000-8000-000000000002'
);

insert into public.health_records (
  farm_id, batch_id, record_date, record_type, product_name,
  birds_affected, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-03', 'Vaccination', 'Fixture vaccine', 100,
  '10000000-0000-4000-8000-000000000002'
);

insert into public.sales (
  farm_id, batch_id, sale_date, customer, birds_sold,
  total_weight_kg, price_basis, price_kes, receipt_number, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-04', 'Fixture customer', 2, 5, 'Kg', 300,
  'P1A-B-RECEIPT', '10000000-0000-4000-8000-000000000002'
);

insert into public.cash_entries (
  farm_id, batch_id, entry_date, details, category,
  money_in_kes, money_out_kes, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-04', 'Fixture feed expense', 'feed',
  0, 1000, '10000000-0000-4000-8000-000000000002'
);

insert into public.sale_payments (
  farm_id, sale_id, payment_date, amount_kes, reference, created_by
)
select
  sale.farm_id, sale.id, '2026-01-04', 100, 'P1A-B-PAYMENT',
  '10000000-0000-4000-8000-000000000002'
from public.sales sale
where sale.farm_id = '20000000-0000-4000-8000-000000000002';

insert into public.assets (
  farm_id, name, date_purchased, cost_kes, useful_life_years, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  'Fixture brooder', '2026-01-01', 50000, 5,
  '10000000-0000-4000-8000-000000000002'
);

insert into public.brooding_observations (
  farm_id, batch_id, observation_date, observation_time,
  brooder_temp_c, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-02', '08:00', 32,
  '10000000-0000-4000-8000-000000000002'
);

insert into public.biosecurity_visits (
  farm_id, visit_date, time_in, visitor_name, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '2026-01-02', '09:00', 'Fixture visitor',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.house_activity_records (
  farm_id, batch_id, activity_date, house, activity_type, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-02', 'B1', 'litter_check',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.labour_records (
  farm_id, batch_id, record_type, record_date, worker_name,
  hours_worked, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  'attendance', '2026-01-02', 'Fixture worker', 8,
  '10000000-0000-4000-8000-000000000002'
);

insert into public.utility_usage (
  farm_id, batch_id, usage_date, utility_type, quantity, unit, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '2026-01-02', 'electricity', 12, 'kWh',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.maintenance_records (
  farm_id, batch_id, asset_id, record_date, description, created_by
)
select
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  asset.id, '2026-01-03', 'Fixture service',
  '10000000-0000-4000-8000-000000000002'
from public.assets asset
where asset.farm_id = '20000000-0000-4000-8000-000000000002';

insert into public.compliance_records (
  farm_id, document_type, document_number, created_by
) values (
  '20000000-0000-4000-8000-000000000002',
  'Farm licence', 'P1A-B-LICENCE',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.farm_invitations (
  farm_id, email, role, invited_by, full_name
) values (
  '20000000-0000-4000-8000-000000000002',
  'invite@example.invalid', 'attendant',
  '10000000-0000-4000-8000-000000000002', 'Fixture invitee'
);

insert into public.subscription_payments (
  farm_subscription_id, farm_id, amount_minor, provider,
  provider_reference, status
)
select sub.id, sub.farm_id, 1000, 'phase1a-fixture',
       'P1A-SUB-PAYMENT', 'pending'
from public.farm_subscriptions sub
where sub.farm_id = '20000000-0000-4000-8000-000000000002';

insert into public.subscription_invoices (
  farm_id, farm_subscription_id, invoice_number, amount_minor, status
)
select sub.farm_id, sub.id, 'P1A-B-INVOICE', 1000, 'issued'
from public.farm_subscriptions sub
where sub.farm_id = '20000000-0000-4000-8000-000000000002';

insert into public.subscription_events (
  farm_id, farm_subscription_id, event_type, actor_user_id
)
select sub.farm_id, sub.id, 'phase1a_fixture', sub.created_by
from public.farm_subscriptions sub
where sub.farm_id = '20000000-0000-4000-8000-000000000002';

insert into public.subscription_usage (
  farm_id, farm_subscription_id, metric_key, usage_value
)
select sub.farm_id, sub.id, 'active_batches', 1
from public.farm_subscriptions sub
where sub.farm_id = '20000000-0000-4000-8000-000000000002';

update public.batches
set status = 'closed', date_sold_out = '2026-01-10'
where id = '30000000-0000-4000-8000-000000000002';

insert into public.corrections (
  farm_id, batch_id, source_table, source_record_id, reason,
  dead_delta, created_by
)
select
  daily.farm_id, daily.batch_id, 'daily_records', daily.id,
  'Phase 1A isolation fixture', 1,
  '10000000-0000-4000-8000-000000000002'
from public.daily_records daily
where daily.batch_id = '30000000-0000-4000-8000-000000000002';

set local role authenticated;

do $$
declare
  visible bigint;
  sold_birds bigint;
  sold_weight numeric;
begin
  select count(*) into visible
  from public.batch_performance
  where farm_id = '20000000-0000-4000-8000-000000000002'
    and batch_id = '30000000-0000-4000-8000-000000000002';
  perform pg_temp.assert_true(visible = 1, 'Authenticated dashboard can load batch performance');

  select birds_sold, live_weight_sold_kg
    into sold_birds, sold_weight
  from public.get_batch_operational_sales(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002'
  );
  perform pg_temp.assert_true(
    sold_birds = 2 and sold_weight = 5,
    'Operational sales helper returns declared count and weight types'
  );

  select count(*) into visible
  from public.farm_dashboard
  where farm_id = '20000000-0000-4000-8000-000000000002';
  perform pg_temp.assert_true(visible = 1, 'Authenticated dashboard can load farm summary');
end;
$$;

reset role;

-- Authenticate as owner of Farm A.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  table_name text;
  visible bigint;
  denied_by_grant boolean;
begin
  foreach table_name in array array[
    'batches', 'daily_records', 'weight_records', 'feed_deliveries',
    'health_records', 'sales', 'cash_entries', 'inventory_items',
    'stock_movements', 'assets', 'corrections', 'audit_events',
    'sale_payments', 'brooding_observations', 'biosecurity_visits',
    'house_activity_records', 'labour_records', 'utility_usage',
    'maintenance_records', 'compliance_records', 'farm_invitations',
    'farm_staff_seat_reservations', 'farm_subscriptions',
    'subscription_payments', 'subscription_invoices',
    'subscription_events', 'subscription_usage'
  ] loop
    denied_by_grant := false;
    begin
      execute format(
        'select count(*) from public.%I where farm_id = $1',
        table_name
      ) into visible using '20000000-0000-4000-8000-000000000002'::uuid;
    exception when insufficient_privilege then
      denied_by_grant := true;
    end;
    perform pg_temp.assert_true(
      denied_by_grant or visible = 0,
      'Farm A cannot SELECT Farm B rows from ' || table_name
    );
  end loop;
end;
$$;

do $$
declare
  visible bigint;
begin
  select count(*) into visible
  from public.farms
  where id = '20000000-0000-4000-8000-000000000002';
  perform pg_temp.assert_true(visible = 0, 'Farm A cannot SELECT Farm B farm row');

  select count(*) into visible
  from public.farm_memberships
  where farm_id = '20000000-0000-4000-8000-000000000002';
  perform pg_temp.assert_true(visible = 0, 'Farm A cannot SELECT Farm B memberships');
end;
$$;

-- Cross-farm record ID plus authorized Farm A ID must not update/delete Farm B data.
do $$
declare
  updated_count bigint;
  deleted_count bigint;
  rejected boolean;
begin
  update public.batches
  set remarks = 'CROSS_TENANT_ATTACK'
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and id = '30000000-0000-4000-8000-000000000002';
  get diagnostics updated_count = row_count;
  perform pg_temp.assert_true(updated_count = 0, 'Cross-farm batch UPDATE by record ID and Farm A ID affects zero rows');

  delete from public.batches
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and id = '30000000-0000-4000-8000-000000000002';
  get diagnostics deleted_count = row_count;
  perform pg_temp.assert_true(deleted_count = 0, 'Cross-farm batch DELETE by record ID and Farm A ID affects zero rows');

  update public.batches
  set remarks = 'CROSS_TENANT_ATTACK'
  where farm_id = '20000000-0000-4000-8000-000000000002'
    and id = '30000000-0000-4000-8000-000000000002';
  get diagnostics updated_count = row_count;
  perform pg_temp.assert_true(updated_count = 0, 'Farm A cannot UPDATE Farm B batch using Farm B ID');

  delete from public.batches
  where farm_id = '20000000-0000-4000-8000-000000000002'
    and id = '30000000-0000-4000-8000-000000000002';
  get diagnostics deleted_count = row_count;
  perform pg_temp.assert_true(deleted_count = 0, 'Farm A cannot DELETE Farm B batch using Farm B ID');

  rejected := false;
  begin
    insert into public.daily_records (
      farm_id, batch_id, record_date, dead, culled, feed_given_kg,
      feed_left_kg, water_liters, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '2026-01-03', 0, 0, 10, 0, 20,
      '10000000-0000-4000-8000-000000000001'
    );
  exception when foreign_key_violation or raise_exception then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Farm A cannot attach record to Farm B batch');

  rejected := false;
  begin
    insert into public.daily_records (
      farm_id, batch_id, record_date, dead, culled, feed_given_kg,
      feed_left_kg, water_liters, created_by
    ) values (
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      '2026-01-03', 0, 0, 10, 0, 20,
      '10000000-0000-4000-8000-000000000001'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Farm A cannot INSERT into Farm B tenant');

  rejected := false;
  begin
    insert into public.stock_movements (
      farm_id, item_id, batch_id, movement_date, received, used, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '2026-01-03', 1, 0,
      '10000000-0000-4000-8000-000000000001'
    );
  exception when foreign_key_violation or raise_exception then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Farm A cannot reference Farm B inventory item');
end;
$$;

-- Manager can perform manager operations in Farm A.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select public.create_batch_with_quota(
  '20000000-0000-4000-8000-000000000001', 'P1A-MGR-1', 'Broiler',
  null, null, '2026-01-03', null, null, 20, 20, null
);
insert into phase1a_assertions(name)
values ('Farm A manager creates batch using quota-authorized RPC');

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.farm_memberships (farm_id, user_id, role)
    values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'manager'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Manager cannot directly insert farm membership');

  rejected := false;
  begin
    perform public.update_farm_member_role(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003',
      'owner'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Manager cannot promote self to owner');
end;
$$;

-- Accountants use authorized transaction RPCs; direct financial table writes are blocked.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.sales (
      farm_id, batch_id, sale_date, customer, birds_sold, total_weight_kg,
      price_basis, price_kes, receipt_number, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '2026-01-04', 'Unauthorized direct insert', 2, 5, 'Kg', 300, 'P1A-DIRECT',
      '10000000-0000-4000-8000-000000000004'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Accountant cannot directly INSERT sale');
end;
$$;

select public.create_sale_idempotent(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '2026-01-04', 'A Customer', 2, 5, 'Kg', 300, 0, 'P1A-R1',
  'Accountant RPC test', 'p1a-acct-sale-0001'
);

select public.create_cash_entry_idempotent(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '2026-01-04', 'Accountant test income', 'sale', null,
  100, 0, 'p1a-acct-cash-0001'
);

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.daily_records (
      farm_id, batch_id, record_date, dead, culled, feed_given_kg,
      feed_left_kg, water_liters, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '2026-01-05', 0, 0, 10, 0, 20,
      '10000000-0000-4000-8000-000000000004'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Accountant cannot INSERT daily record');
end;
$$;

do $$
declare
  target_sale_id uuid;
  first_payment jsonb;
  replayed_payment jsonb;
  rejected boolean := false;
begin
  select id into target_sale_id from public.sales
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and receipt_number = 'P1A-R1';

  select public.create_sale_payment_idempotent(
    '20000000-0000-4000-8000-000000000001', target_sale_id, '2026-01-05',
    250, 'P1A-PAY-1', 'p1a-acct-payment-0001'
  ) into first_payment;
  select public.create_sale_payment_idempotent(
    '20000000-0000-4000-8000-000000000001', target_sale_id, '2026-01-05',
    250, 'P1A-PAY-1', 'p1a-acct-payment-0001'
  ) into replayed_payment;
  perform pg_temp.assert_true(
    first_payment->>'id' = replayed_payment->>'id',
    'Payment retry with same payload returns original payment'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.sale_payments
     where farm_id = '20000000-0000-4000-8000-000000000001' and sale_payments.sale_id = target_sale_id),
    'Payment retry creates only one payment'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.cash_entries
     where sale_payment_id = (first_payment->>'id')::uuid),
    'Payment transaction creates exactly one cashbook receipt'
  );

  begin
    perform public.create_sale_payment_idempotent(
      '20000000-0000-4000-8000-000000000001', target_sale_id, '2026-01-05',
      251, 'P1A-PAY-1', 'p1a-acct-payment-0001'
    );
  exception when raise_exception then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Payment idempotency key rejects changed payload');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  sale_id uuid;
  request_id uuid;
  rejected boolean := false;
begin
  select id into sale_id from public.sales
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and receipt_number = 'P1A-R1';
  select (public.create_financial_correction_request(
    '20000000-0000-4000-8000-000000000001', 'sale_adjustment', sale_id,
    null, null, null, 0, 0, 50, null, 'Corrected sale amount',
    'p1a-manager-correction-1'
  )->>'id')::uuid into request_id;

  begin
    perform public.decide_financial_correction(
      request_id, 'approved', 'Manager cannot approve', 'p1a-manager-decision-1'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Manager cannot approve financial correction');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  request_id uuid;
  result jsonb;
  rejected boolean := false;
begin
  select id into request_id from public.financial_correction_requests
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and initiated_by = '10000000-0000-4000-8000-000000000003'
    and idempotency_key = 'p1a-manager-correction-1';
  select public.decide_financial_correction(
    request_id, 'approved', 'Owner verified correction', 'p1a-owner-decision-0001'
  ) into result;
  perform pg_temp.assert_true(result->>'status' = 'approved', 'Owner approves manager correction');
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.sale_adjustments
     where correction_request_id = request_id and revenue_kes_delta = 50),
    'Approved correction applies one sale adjustment'
  );

  select (public.create_financial_correction_request(
    '20000000-0000-4000-8000-000000000001', 'sale_adjustment',
    (select id from public.sales where receipt_number = 'P1A-R1'),
    null, null, null, 0, 0, 10, null, 'Owner self-approval test',
    'p1a-owner-correction-0001'
  )->>'id')::uuid into request_id;
  begin
    perform public.decide_financial_correction(
      request_id, 'approved', 'Cannot self approve', 'p1a-owner-self-decision-1'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Owner cannot approve own financial correction');
  perform pg_temp.assert_true(
    not exists (select 1 from public.sale_adjustments where correction_request_id = request_id),
    'Rejected self-approval creates no financial effect'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  payment_id uuid;
  request_id uuid;
  rejected boolean := false;
begin
  select id into payment_id from public.sale_payments
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and reference = 'P1A-PAY-1';
  select (public.create_financial_correction_request(
    '20000000-0000-4000-8000-000000000001', 'payment_refund',
    null, payment_id, null, null, 0, 0, 0, 50,
    'Approved partial refund', 'p1a-accountant-refund-1'
  )->>'id')::uuid into request_id;

  begin
    perform public.decide_financial_correction(
      request_id, 'approved', 'Accountant cannot approve', 'p1a-accountant-decision-1'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Accountant cannot approve financial correction');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  request_id uuid;
  result jsonb;
begin
  select id into request_id from public.financial_correction_requests
  where farm_id = '20000000-0000-4000-8000-000000000001'
    and idempotency_key = 'p1a-accountant-refund-1';
  select public.decide_financial_correction(
    request_id, 'approved', 'Owner approved partial refund', 'p1a-owner-refund-decision-1'
  ) into result;
  perform pg_temp.assert_true(result->>'status' = 'approved', 'Owner approves refund request');
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.sale_refunds where correction_request_id = request_id),
    'Approved refund creates one refund transaction'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.cash_entries
     where sale_refund_id = (result->>'effectId')::uuid and money_out_kes = 50),
    'Approved refund creates one linked cashbook outflow'
  );
end;
$$;

-- Attendant can add daily and stock activity but not health or sales.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into public.daily_records (
  farm_id, batch_id, record_date, dead, culled, feed_given_kg,
  feed_left_kg, water_liters, created_by
) values (
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '2026-01-06', 0, 0, 12, 2, 25,
  '10000000-0000-4000-8000-000000000005'
);

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.health_records (
      farm_id, batch_id, record_date, record_type, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '2026-01-06', 'Vaccination',
      '10000000-0000-4000-8000-000000000005'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Attendant cannot INSERT health record');
end;
$$;

-- Veterinarian can add health records but not sales or cash.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into public.health_records (
  farm_id, batch_id, record_date, record_type, product_name,
  birds_affected, created_by
) values (
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '2026-01-06', 'Vaccination', 'P1A vaccine', 100,
  '10000000-0000-4000-8000-000000000006'
);

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.cash_entries (
      farm_id, batch_id, entry_date, details, category,
      money_out_kes, money_in_kes, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '2026-01-06', 'Unauthorized expense', 'expense',
      10, 0, '10000000-0000-4000-8000-000000000006'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Veterinarian cannot INSERT cash entry');
end;
$$;

-- Owner A must not read or mutate Farm B via SECURITY DEFINER listing/trial/quota RPCs.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  result jsonb;
  rejected boolean := false;
begin
  select public.get_farm_audit_page(
    '20000000-0000-4000-8000-000000000001', 'all'
  ) into result;
  perform pg_temp.assert_true((result->>'total')::integer > 0, 'Owner can list full farm audit');
  perform pg_temp.assert_true(
    exists (
      select 1
      from jsonb_array_elements(result->'data') event
      where event->'new_data' <> 'null'::jsonb
    ),
    'Owner audit includes event details'
  );

  begin
    perform public.get_farm_audit_page(
      '20000000-0000-4000-8000-000000000002', 'all'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Farm A owner cannot read Farm B audit');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  result jsonb;
  rejected boolean := false;
begin
  select public.get_farm_audit_page(
    '20000000-0000-4000-8000-000000000001', 'operational'
  ) into result;
  perform pg_temp.assert_true((result->>'total')::integer > 0, 'Manager can list operational audit');
  perform pg_temp.assert_true(
    not exists (
      select 1
      from jsonb_array_elements(result->'data') event
      where event->'old_data' <> 'null'::jsonb or event->'new_data' <> 'null'::jsonb
    ),
    'Manager operational audit redacts before-and-after data'
  );

  select public.get_farm_audit_page(
    '20000000-0000-4000-8000-000000000001', 'inventory'
  ) into result;
  perform pg_temp.assert_true((result->>'total')::integer > 0, 'Manager can list inventory audit');

  begin
    perform public.get_farm_audit_page(
      '20000000-0000-4000-8000-000000000001', 'all'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Manager cannot request full farm audit');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  result jsonb;
  rejected boolean := false;
begin
  select public.get_farm_audit_page(
    '20000000-0000-4000-8000-000000000001', 'financial'
  ) into result;
  perform pg_temp.assert_true((result->>'total')::integer > 0, 'Accountant can list financial audit');

  begin
    perform public.get_farm_audit_page(
      '20000000-0000-4000-8000-000000000001', 'operational'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Accountant cannot view operational audit');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  result jsonb;
  rejected boolean := false;
begin
  select public.get_farm_audit_page(
    '20000000-0000-4000-8000-000000000001', 'inventory'
  ) into result;
  perform pg_temp.assert_true((result->>'total')::integer > 0, 'Inventory officer can list inventory audit');

  begin
    perform public.get_farm_audit_page(
      '20000000-0000-4000-8000-000000000001', 'financial'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Inventory officer cannot view financial audit');
end;
$$;

reset role;
insert into public.platform_administrators (user_id, active)
values ('10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  result jsonb;
  rejected boolean := false;
begin
  select public.get_platform_audit_page() into result;
  perform pg_temp.assert_true(result is not null, 'Platform admin can load platform audit');

  begin
    perform * from public.platform_audit_events;
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Platform audit table is not directly readable');
end;
$$;

reset role;
do $$
declare
  rejected boolean := false;
begin
  begin
    update public.audit_access_logs
    set category = 'operational'
    where actor_user_id = '10000000-0000-4000-8000-000000000001';
  exception when raise_exception then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Audit access logs are append-only');
  perform pg_temp.assert_true(
    (select count(*) >= 5 from public.audit_access_logs),
    'Farm audit list and platform audit access are logged'
  );
end;
$$;

reset role;
set local role anon;

do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.get_farm_audit_page(
      '20000000-0000-4000-8000-000000000001', 'all'
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Anonymous role cannot execute farm audit RPC');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.start_professional_trial('20000000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Owner A unexpectedly started a trial for Farm B';
  end if;
  perform pg_temp.assert_true(rejected, 'Cross-farm start_professional_trial rejected');

  rejected := false;
  begin
    perform public.reserve_farm_staff_seat(
      '20000000-0000-4000-8000-000000000002',
      'cross@example.invalid', 'attendant', null,
      repeat('1', 64), repeat('2', 64)
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Owner A unexpectedly reserved a staff seat for Farm B';
  end if;
  perform pg_temp.assert_true(rejected, 'Cross-farm reserve_farm_staff_seat rejected');

  rejected := false;
  begin
    perform public.create_batch_with_quota(
      '20000000-0000-4000-8000-000000000002', 'P1A-CROSS-RPC',
      'Broiler', null, null, '2026-01-03', null, null, 10, 10, null
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Owner A unexpectedly created a batch for Farm B';
  end if;
  perform pg_temp.assert_true(rejected, 'Cross-farm create_batch_with_quota rejected');
end;
$$;

-- Verify anonymous access is denied for privileged and farm data.
reset role;
set local role anon;

do $$
declare
  rejected boolean := false;
begin
  begin
    perform * from public.farms;
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'Anonymous role cannot SELECT farms');
end;
$$;

reset role;

do $$
declare
  bad_function text;
begin
  select p.oid::regprocedure::text into bad_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not coalesce(p.proconfig @> array['search_path=""'], false)
  limit 1;
  perform pg_temp.assert_true(
    bad_function is null,
    'Every public SECURITY DEFINER function has an empty search_path'
  );
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.start_professional_trial(uuid)', 'EXECUTE'),
    'Anon cannot execute start_professional_trial'
  );
  perform pg_temp.assert_true(
    has_function_privilege('authenticated', 'public.start_professional_trial(uuid)', 'EXECUTE'),
    'Authenticated can execute start_professional_trial'
  );
  perform pg_temp.assert_true(
    has_function_privilege('service_role', 'public.finalize_farm_staff_invitation(uuid,uuid,text)', 'EXECUTE'),
    'service_role can execute finalize_farm_staff_invitation'
  );
  perform pg_temp.assert_true(
    not has_function_privilege('authenticated', 'public.finalize_farm_staff_invitation(uuid,uuid,text)', 'EXECUTE'),
    'authenticated cannot execute finalize_farm_staff_invitation'
  );
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.transition_subscription_status(uuid,text,uuid,text)', 'EXECUTE'),
    'anon cannot execute transition_subscription_status'
  );
end;
$$;

select count(*) as assertions_passed from phase1a_assertions;
reset role;
rollback;
