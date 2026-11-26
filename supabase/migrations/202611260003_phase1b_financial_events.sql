create table public.farm_opening_cash_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null unique references public.farms(id) on delete restrict,
  application_id uuid references public.farm_onboarding_applications(id) on delete restrict,
  amount_kes numeric(12, 2) not null check (amount_kes >= 0),
  provenance text not null check (provenance in ('new_onboarding', 'legacy_snapshot')),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (farm_id, id),
  foreign key (farm_id, application_id)
    references public.farm_onboarding_applications(farm_id, id) on delete restrict
);

alter table public.farm_onboarding_applications
  add constraint farm_onboarding_source_invitation_fkey
    foreign key (source_invitation_id)
    references public.platform_owner_invitations(id) on delete restrict;

alter table public.corrections
  add constraint corrections_farm_id_id_key unique (farm_id, id);

alter table public.sale_payments
  add constraint sale_payments_farm_id_id_key unique (farm_id, id),
  add constraint sale_payments_farm_id_id_sale_id_key unique (farm_id, id, sale_id);

alter table public.cash_entries
  add constraint cash_entries_farm_id_id_key unique (farm_id, id);

insert into public.farm_opening_cash_records (
  farm_id, amount_kes, provenance, created_by, created_at
)
select
  farm.id,
  farm.opening_cash_balance_kes,
  'legacy_snapshot',
  farm.created_by,
  farm.created_at
from public.farms farm;

create table public.financial_correction_requests (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  correction_kind text not null check (correction_kind in (
    'sale_adjustment',
    'payment_refund',
    'cash_entry_reversal',
    'opening_cash_adjustment'
  )),
  source_sale_id uuid,
  source_payment_id uuid,
  source_cash_entry_id uuid,
  source_opening_cash_id uuid,
  birds_sold_delta integer not null default 0,
  live_weight_sold_kg_delta numeric(12, 3) not null default 0,
  revenue_kes_delta numeric(12, 2) not null default 0,
  amount_kes numeric(12, 2),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  initiated_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 128),
  payload_hash text not null check (length(payload_hash) = 64),
  created_at timestamptz not null default now(),
  unique (farm_id, id),
  unique (farm_id, initiated_by, idempotency_key),
  foreign key (farm_id, source_sale_id)
    references public.sales(farm_id, id) on delete restrict,
  foreign key (farm_id, source_payment_id)
    references public.sale_payments(farm_id, id) on delete restrict,
  foreign key (farm_id, source_cash_entry_id)
    references public.cash_entries(farm_id, id) on delete restrict,
  foreign key (farm_id, source_opening_cash_id)
    references public.farm_opening_cash_records(farm_id, id) on delete restrict,
  check (
    case correction_kind
      when 'sale_adjustment' then
        source_sale_id is not null
        and source_payment_id is null
        and source_cash_entry_id is null
        and source_opening_cash_id is null
        and amount_kes is null
        and (birds_sold_delta <> 0 or live_weight_sold_kg_delta <> 0 or revenue_kes_delta <> 0)
      when 'payment_refund' then
        source_sale_id is null
        and source_payment_id is not null
        and source_cash_entry_id is null
        and source_opening_cash_id is null
        and birds_sold_delta = 0
        and live_weight_sold_kg_delta = 0
        and revenue_kes_delta = 0
        and amount_kes is not null
        and amount_kes > 0
      when 'cash_entry_reversal' then
        source_sale_id is null
        and source_payment_id is null
        and source_cash_entry_id is not null
        and source_opening_cash_id is null
        and birds_sold_delta = 0
        and live_weight_sold_kg_delta = 0
        and revenue_kes_delta = 0
        and amount_kes is not null
        and amount_kes > 0
      when 'opening_cash_adjustment' then
        source_sale_id is null
        and source_payment_id is null
        and source_cash_entry_id is null
        and source_opening_cash_id is not null
        and birds_sold_delta = 0
        and live_weight_sold_kg_delta = 0
        and revenue_kes_delta = 0
        and amount_kes is not null
        and amount_kes <> 0
      else false
    end
  )
);

create table public.financial_correction_decisions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  request_id uuid not null unique,
  decision text not null check (decision in ('approved', 'rejected')),
  decided_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 128),
  payload_hash text not null check (length(payload_hash) = 64),
  decided_at timestamptz not null default now(),
  unique (farm_id, id),
  unique (farm_id, decided_by, idempotency_key),
  foreign key (farm_id, request_id)
    references public.financial_correction_requests(farm_id, id) on delete restrict
);

create table public.sale_adjustments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  sale_id uuid not null,
  correction_request_id uuid not null unique,
  birds_sold_delta integer not null default 0,
  live_weight_sold_kg_delta numeric(12, 3) not null default 0,
  revenue_kes_delta numeric(12, 2) not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (farm_id, id),
  foreign key (farm_id, sale_id) references public.sales(farm_id, id) on delete restrict,
  foreign key (farm_id, correction_request_id)
    references public.financial_correction_requests(farm_id, id) on delete restrict,
  check (
    birds_sold_delta <> 0
    or live_weight_sold_kg_delta <> 0
    or revenue_kes_delta <> 0
  )
);

create table public.sale_refunds (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  sale_id uuid not null,
  payment_id uuid not null,
  correction_request_id uuid not null unique,
  refund_date date not null,
  amount_kes numeric(12, 2) not null check (amount_kes > 0),
  reference text,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (farm_id, id),
  foreign key (farm_id, sale_id) references public.sales(farm_id, id) on delete restrict,
  foreign key (farm_id, payment_id, sale_id)
    references public.sale_payments(farm_id, id, sale_id) on delete restrict,
  foreign key (farm_id, correction_request_id)
    references public.financial_correction_requests(farm_id, id) on delete restrict
);

alter table public.cash_entries
  add column sale_refund_id uuid,
  add column financial_correction_request_id uuid,
  add column reverses_cash_entry_id uuid,
  add constraint cash_entries_sale_refund_fkey
    foreign key (farm_id, sale_refund_id)
    references public.sale_refunds(farm_id, id) on delete restrict,
  add constraint cash_entries_financial_correction_fkey
    foreign key (farm_id, financial_correction_request_id)
    references public.financial_correction_requests(farm_id, id) on delete restrict,
  add constraint cash_entries_reversal_source_fkey
    foreign key (farm_id, reverses_cash_entry_id)
    references public.cash_entries(farm_id, id) on delete restrict,
  add constraint cash_entries_correction_request_unique
    unique (financial_correction_request_id),
  add constraint cash_entries_reversal_unique
    unique (reverses_cash_entry_id),
  add constraint cash_entries_sale_refund_unique
    unique (sale_refund_id),
  add constraint cash_entries_payment_refund_source_check
    check (num_nonnulls(sale_payment_id, sale_refund_id, financial_correction_request_id) <= 1);

create table public.legacy_financial_reconciliation (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  source_correction_id uuid not null unique,
  batch_id uuid not null,
  source_table text not null,
  source_record_id uuid,
  reason text not null,
  revenue_kes_delta numeric(12, 2) not null default 0,
  paid_kes_delta numeric(12, 2) not null default 0,
  money_in_kes_delta numeric(12, 2) not null default 0,
  money_out_kes_delta numeric(12, 2) not null default 0,
  initiated_by uuid references auth.users(id) on delete restrict,
  original_created_at timestamptz not null,
  unique (farm_id, id),
  foreign key (farm_id, batch_id) references public.batches(farm_id, id) on delete restrict,
  foreign key (farm_id, source_correction_id) references public.corrections(farm_id, id) on delete restrict
);

create table public.legacy_financial_reconciliation_decisions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  reconciliation_id uuid not null unique,
  decision text not null check (decision in ('verified_payment', 'verified_refund', 'not_a_cash_transaction')),
  linked_payment_id uuid,
  linked_refund_id uuid,
  decided_by uuid not null references auth.users(id) on delete restrict,
  evidence_reference text not null check (length(trim(evidence_reference)) between 1 and 512),
  decided_at timestamptz not null default now(),
  unique (farm_id, id),
  foreign key (farm_id, reconciliation_id)
    references public.legacy_financial_reconciliation(farm_id, id) on delete restrict,
  foreign key (farm_id, linked_payment_id)
    references public.sale_payments(farm_id, id) on delete restrict,
  foreign key (farm_id, linked_refund_id)
    references public.sale_refunds(farm_id, id) on delete restrict,
  check (
    (decision = 'verified_payment' and linked_payment_id is not null and linked_refund_id is null)
    or (decision = 'verified_refund' and linked_refund_id is not null and linked_payment_id is null)
    or (decision = 'not_a_cash_transaction' and linked_payment_id is null and linked_refund_id is null)
  )
);

insert into public.legacy_financial_reconciliation (
  farm_id, source_correction_id, batch_id, source_table, source_record_id,
  reason, revenue_kes_delta, paid_kes_delta, money_in_kes_delta,
  money_out_kes_delta, initiated_by, original_created_at
)
select
  correction.farm_id,
  correction.id,
  correction.batch_id,
  correction.source_table,
  correction.source_record_id,
  correction.reason,
  correction.revenue_kes_delta,
  correction.paid_kes_delta,
  correction.money_in_kes_delta,
  correction.money_out_kes_delta,
  correction.created_by,
  correction.created_at
from public.corrections correction
where correction.revenue_kes_delta <> 0
   or correction.paid_kes_delta <> 0
   or correction.money_in_kes_delta <> 0
   or correction.money_out_kes_delta <> 0;

create function public.prevent_financial_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Financial history is append-only';
end;
$$;

create trigger farm_opening_cash_records_append_only
before update or delete on public.farm_opening_cash_records
for each row execute function public.prevent_financial_event_mutation();

create trigger financial_correction_requests_append_only
before update or delete on public.financial_correction_requests
for each row execute function public.prevent_financial_event_mutation();

create trigger financial_correction_decisions_append_only
before update or delete on public.financial_correction_decisions
for each row execute function public.prevent_financial_event_mutation();

create trigger sale_adjustments_append_only
before update or delete on public.sale_adjustments
for each row execute function public.prevent_financial_event_mutation();

create trigger sale_refunds_append_only
before update or delete on public.sale_refunds
for each row execute function public.prevent_financial_event_mutation();

create trigger legacy_financial_reconciliation_append_only
before update or delete on public.legacy_financial_reconciliation
for each row execute function public.prevent_financial_event_mutation();

create trigger legacy_financial_reconciliation_decisions_append_only
before update or delete on public.legacy_financial_reconciliation_decisions
for each row execute function public.prevent_financial_event_mutation();

alter table public.farm_opening_cash_records enable row level security;
alter table public.financial_correction_requests enable row level security;
alter table public.financial_correction_decisions enable row level security;
alter table public.sale_adjustments enable row level security;
alter table public.sale_refunds enable row level security;
alter table public.legacy_financial_reconciliation enable row level security;
alter table public.legacy_financial_reconciliation_decisions enable row level security;

create policy farm_opening_cash_finance_read
on public.farm_opening_cash_records
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

create policy financial_correction_requests_finance_read
on public.financial_correction_requests
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

create policy financial_correction_decisions_finance_read
on public.financial_correction_decisions
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

create policy sale_adjustments_finance_read
on public.sale_adjustments
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

create policy sale_refunds_finance_read
on public.sale_refunds
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

create policy legacy_financial_reconciliation_finance_read
on public.legacy_financial_reconciliation
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

create policy legacy_financial_reconciliation_decisions_finance_read
on public.legacy_financial_reconciliation_decisions
for select to authenticated
using (public.has_farm_permission(farm_id, 'finance.view'));

revoke all on public.farm_opening_cash_records,
  public.financial_correction_requests,
  public.financial_correction_decisions,
  public.sale_adjustments,
  public.sale_refunds,
  public.legacy_financial_reconciliation,
  public.legacy_financial_reconciliation_decisions
from public, anon, authenticated;

grant select on public.farm_opening_cash_records,
  public.financial_correction_requests,
  public.financial_correction_decisions,
  public.sale_adjustments,
  public.sale_refunds,
  public.legacy_financial_reconciliation,
  public.legacy_financial_reconciliation_decisions
to authenticated;

create index financial_correction_requests_farm_created_idx
  on public.financial_correction_requests (farm_id, created_at desc);
create index financial_correction_requests_initiator_idx
  on public.financial_correction_requests (initiated_by, created_at desc);
create index legacy_financial_reconciliation_farm_idx
  on public.legacy_financial_reconciliation (farm_id, original_created_at desc);

create trigger sale_adjustments_audit
after insert on public.sale_adjustments
for each row execute function public.write_audit_event();

create trigger sale_refunds_audit
after insert on public.sale_refunds
for each row execute function public.write_audit_event();

create trigger farm_opening_cash_records_audit
after insert on public.farm_opening_cash_records
for each row execute function public.write_audit_event();

create trigger financial_correction_requests_audit
after insert on public.financial_correction_requests
for each row execute function public.write_audit_event();

create trigger financial_correction_decisions_audit
after insert on public.financial_correction_decisions
for each row execute function public.write_audit_event();
