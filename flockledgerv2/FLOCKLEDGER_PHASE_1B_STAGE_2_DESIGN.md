# FlockLedger Phase 1B — Stage 2 Design Proposal

**Status:** Design for approval; implementation has not started.  
**Date:** 26 November 2026  
**Scope:** Controlled farm onboarding and lifecycle, financial write controls, correction approval, immutable opening cash, and role-scoped audit access.

## 1. Decisions incorporated from the owner

This design treats the user's submitted policy as authoritative:

- Farm applications require platform-administrator approval before activation. Email registration may create an applicant identity but never an active farm.
- Pending farms cannot create sales, production, inventory, or financial transactions. Only a platform administrator may approve, reject, suspend, or reactivate a farm.
- A platform administrator can inspect onboarding/governance information but receives no tenant financial, employee, or operational-record access.
- Financial reads are allowed to `owner`, `manager`, and `accountant`.
- Transaction creation is separated:

  | Action | Owner | Manager | Accountant | Attendant | Veterinarian | Inventory officer | Platform administrator |
  |---|---:|---:|---:|---:|---:|---:|---:|
  | Create sale | Yes | Yes | Yes | No | No | No | No |
  | Record sale payment | Yes | No | Yes | No | No | No | No |
  | Create direct cashbook entry | Yes | No | Yes | No | No | No | No |

  A payment recorded by an authorized role continues to create its linked cashbook receipt atomically. A manager may create a sale only with zero initial payment; a non-zero initial payment requires the separate payment permission.
- Financial correction requests are append-only, reasoned, and reference an original transaction. Managers/accountants may initiate; only a different farm owner may approve or reject. Owners may initiate, but cannot approve their own request.
- Paid totals change only through payment/refund transactions. Pending/rejected requests have no financial effect.
- Opening cash is captured once, becomes effective only on activation, and is immutable. Later adjustments are append-only approved cashbook events.
- Audit-event visibility is scoped to the role/category policy supplied by the owner. Raw event JSON is not directly queryable by tenant clients; exports use the same filtered projection.
- Authenticated direct INSERT/UPDATE/DELETE is removed from financial tables when the validated RPC path is in place.
- A fresh disposable Supabase project is available for future end-to-end testing. The previously used hosted project is contaminated and must not be reused.

## 2. Current implementation traced

### Farm and membership

- `farm_role` currently contains `owner`, `manager`, `attendant`, `accountant`, and `veterinarian`; there is no inventory-officer or platform-administrator role. See [202611210001_initial_schema.sql](../supabase/migrations/202611210001_initial_schema.sql#L1).
- A farm currently has no lifecycle state. `farm_memberships` is created immediately with the owner role.
- `POST /api/farms` calls the two-argument `create_farm(name, opening_balance)` RPC. The original one-argument `create_farm(name)` remains separately executable by `authenticated`. Both database functions create an active farm and owner membership. See [farms/route.ts](../src/app/api/farms/route.ts#L53), [initial create_farm](../supabase/migrations/202611210001_initial_schema.sql#L79), and [opening-balance create_farm](../supabase/migrations/202611210004_farm_dashboard_summary.sql#L5).
- Farm creation fires `farms_create_starter_subscription`, which currently creates an active Starter subscription and an append-only event. A one-current-subscription-per-farm index exists. See [202611240001_subscription_foundation.sql](../supabase/migrations/202611240001_subscription_foundation.sql#L63) and [subscription trigger](../supabase/migrations/202611240001_subscription_foundation.sql#L311).
- The existing farm list API returns `opening_cash_balance_kes` to all members. The current owner farm-update policy covers the entire farm row.

### Finance and corrections

- Sales store a generated `amount_kes`; the legacy `sales.paid_kes` was migrated to zero and constrained to remain zero. `sale_payments` is the current payment source.
- `create_sale_idempotent` accepts a non-zero initial payment and invokes `create_sale`; `create_sale_payment_idempotent` inserts a payment; a database trigger creates one linked, immutable cashbook income row. See [202611220002_phase2_financial_abuse.sql](../supabase/migrations/202611220002_phase2_financial_abuse.sql#L4) and [202611210005_revenue_payments.sql](../supabase/migrations/202611210005_revenue_payments.sql#L1).
- `create_cash_entry_idempotent` writes direct cashbook entries. The database policy currently allows owner, manager, and accountant; the requested policy removes manager access.
- `create_correction_idempotent` inserts directly into the append-only `corrections` table. The table contains operational and financial deltas, including revenue, paid, and money-in/out adjustments. There is no pending/approved/rejected lifecycle or separation of duties. See [202611220002_phase2_financial_abuse.sql](../supabase/migrations/202611220002_phase2_financial_abuse.sql#L241) and [correction validation](../supabase/migrations/202611210005_revenue_payments.sql#L315).
- `get_revenue_ledger_page` adds `corrections.paid_kes_delta` to payment totals. `farm_dashboard` adds correction cash deltas to the current opening-balance column and cash entries. See [202611220004_phase3_revenue_paging.sql](../supabase/migrations/202611220004_phase3_revenue_paging.sql#L1) and [202611210004_farm_dashboard_summary.sql](../supabase/migrations/202611210004_farm_dashboard_summary.sql#L37).
- The initial migration grants authenticated users broad table DML. Sale/payment/cash/correction RPCs provide an API idempotency path but direct database grants and policies remain. The generic edit route also lists sales and cash entries.

### Audit events

- `audit_events` stores `farm_id`, actor, table name, row ID, operation, and full `old_data`/`new_data` JSON. A dynamic trigger adds audit events to selected operational/financial tables; membership changes have a separate trigger. Farms themselves are not in the dynamic trigger list.
- The table's SELECT policy allows any farm member to read raw event JSON. RLS can filter rows but cannot redact fields inside JSON. There is no audit-event category field, read-access log, or API export route.
- Subscription events are append-only. New platform governance events need a separate platform audit stream so platform administrators do not receive tenant audit access.

## 3. Proposed lifecycle and authorization state machine

### Farm application

The application record is separate from a farm membership. The owner remains an applicant until approval; a pending application does not grant normal tenant access.

```text
new applicant
   |
   | verified account + completed profile; start application
   v
pending_setup
   |
   | owner submits complete application
   v
pending_approval ---- platform admin rejects with reason ----> rejected
   |
   | platform admin approves
   v
active
   |
   | platform admin suspends with reason
   v
suspended ---- platform admin reactivates with reason ----> active
```

Recommended transition rules:

| Transition | Authorized actor | Required checks and effects |
|---|---|---|
| None → `pending_setup` | Authenticated prospective owner; or platform administrator through an owner invitation | Require `auth.uid()`, confirmed email, completed profile, validated farm name, idempotency key. Create the pending farm/application/opening record atomically. Do not create a farm membership. |
| `pending_setup` → `pending_approval` | Applicant owner | Require ownership of the application, completed required fields, verified email and profile. Save an immutable submission version and append a submission event. |
| `pending_approval` → `active` | Active platform administrator other than applicant | Lock farm/application rows; verify state; atomically insert the unique owner membership, activate the existing pending Starter subscription, make the opening balance effective, update lifecycle status and append platform/farm audit events. No financial or operational records are exposed to the administrator. |
| `pending_approval` → `rejected` | Active platform administrator | Require non-empty rejection reason; preserve the application and farm shell; append decision and audit records. No membership or normal farm access is granted. |
| `active` → `suspended` | Active platform administrator | Require a reason; block new operations; append governance events. Subscription status is not changed by suspension. |
| `suspended` → `active` | Active platform administrator | Require a reason; restore the existing memberships and subscription without inserting duplicates; append governance events. |

`rejected` is terminal for that submission. Reapplication should create a new application attempt and retain the prior rejected record; the exact reopen/reapply rule needs approval below. Farm owners cannot call an activation transition. Platform administrators are not farm members and do not receive normal `farms`, sales, cash, staff, or tenant-audit SELECT rights.

### Pending and suspended farm operations

- `pending_setup`, `pending_approval`, and `rejected` have no owner membership, so ordinary farm APIs and direct authenticated table access are denied.
- Every farm-scoped write RPC and RLS mutation policy checks an active farm lifecycle state in addition to tenant membership and the specific permission.
- The owner can read/update only their own application through an applicant-scoped API/RPC; they cannot select normal farm records through that path.
- Recommended suspension behavior is **read-only access for existing members under their normal role-specific read permissions, with all writes and invitations blocked**. This retains business history while preventing new transactions. This needs explicit approval below.

### Platform-administrator identity

Use a separate `platform_administrators` table, not a `farm_role`, user-editable profile field, JWT claim, or service-role shortcut. Its rows have no direct authenticated read/write grants. An `is_platform_admin(auth.uid())` helper and each privileged RPC independently verify active membership in this table. Bootstrap the first administrator through a documented, privileged operator procedure after verifying the Auth user; do not accept administrator IDs from the browser.

Platform-administrator APIs use the authenticated user's cookie-backed client and narrowly scoped RPCs. They must not use a service-role client to query tenant financial records. A platform administrator may read application fields necessary for a decision, platform audit events, and lifecycle status only.

## 4. Proposed financial data and permission model

### Permission catalog

Add a database-owned permission catalog and role-to-permission mapping. Authenticated users cannot modify either table. A `has_farm_permission(farm_id, permission_key)` helper resolves the signed-in user, active membership, farm lifecycle, and role mapping. Platform administrators do not implicitly pass tenant permission checks.

Initial permission keys include:

- `finance.view`
- `finance.sales.create`
- `finance.payments.record`
- `finance.cashbook.create`
- `finance.corrections.initiate`
- `finance.corrections.approve`
- `audit.view.full`, `audit.view.operational`, `audit.view.financial`, `audit.view.inventory`
- `staff.invite`, `staff.assign_role`, `staff.deactivate`

Seed only the owner-approved matrix. For staff administration, keep current owner-only invite/role-change behavior until manager delegation is separately approved. Add the `inventory_officer` farm role in a migration, with inventory-only audit permission and no finance permission. Keep platform administrators in the separate platform table.

### Financial transaction RPCs

1. Keep the existing sale/payment/cash database transactions, but make each RPC check its own permission:
   - sale creation: owner, manager, accountant;
   - payment recording: owner, accountant;
   - direct cashbook entry: owner, accountant.
2. `create_sale_idempotent` rejects non-zero `p_paid_kes` when the caller lacks `finance.payments.record`. For manager-created sales, the initial payment must be zero. Owner/accountant sale creation may create the sale and initial payment atomically; the payment trigger creates exactly one linked cash entry.
3. Keep payment/cashbook trigger-generated cash rows private to the database transaction. A client cannot set `sale_payment_id` or insert a payment-linked cash row directly.
4. Revoke authenticated `INSERT`, `UPDATE`, and `DELETE` on `sales`, `sale_payments`, `cash_entries`, new refund/adjustment tables, and financial correction tables. Keep SELECT grants only where appropriate; RLS applies `finance.view`.
5. Revoke `EXECUTE` on non-idempotent mutation helpers such as `create_sale` from `PUBLIC` and `authenticated`. Expose only purpose-specific, idempotent RPCs, with `auth.uid()` assigned internally and no client-supplied actor or approval state.
6. Remove `sales` and `cash-entries` from generic PATCH/DELETE allowlists. Corrections, refunds, and reversals create compensating events; they never overwrite/delete source rows.
7. Validate farm active state, specific permission, foreign-key farm identity, amount/date/state rules, idempotency key ownership, payload hash, and duplicate constraints in each RPC. Related financial writes and audit events occur in one transaction.

### Correction request and application model

Keep the existing `corrections` rows as immutable historical data and retain an operational-correction path for non-financial flock metrics. Do not let new requests use the generic correction row to change paid totals, cash, or sales revenue outside the approval process.

Proposed new tables:

- `financial_correction_requests`: immutable request, `farm_id`, typed correction kind, exactly one valid source reference, proposed non-paid deltas/amount, mandatory reason, initiator, timestamp, payload hash, idempotency identity. Valid source types are a sale, payment, cashbook entry, or opening-cash record. A request cannot contain a free-form paid-total delta.
- `financial_correction_decisions`: append-only final approve/reject decision, request ID, distinct decision actor, timestamp, and reason. A unique request decision prevents double decisions.
- `sale_adjustments`: append-only approved quantity/weight/revenue adjustment, linked uniquely to the request and original sale. It never changes paid totals.
- `sale_refunds`: append-only approved refund, linked to the original payment and sale, bounded by the unrefunded payment amount. A database trigger creates a linked cashbook outflow in the same transaction.
- Cash-entry reversal/opening adjustment: an approved request creates a new, linked compensating `cash_entries` row with a unique request/reference; it never mutates the original cash entry or opening record.

Approval function locks the request and source row, rechecks farm membership and state, verifies the approver differs from the initiator and has `finance.corrections.approve`, validates the proposed effect against current totals, inserts the specific effect row and decision, and emits audit events atomically. Rejection writes only a decision and reason; it creates no financial effect. Retries with the same idempotency key return the same decision; a second distinct decision conflicts.

**Owner-initiated requests:** Under the supplied permissions, the owner is the only approver and may not approve a request they initiated. Such requests remain pending and have no financial effect. The API/UI must state that no eligible second approver is configured. Do not let a platform administrator approve tenant corrections. A secondary approver role is a future policy decision.

### Opening cash and balance calculation

Add `farm_opening_cash_records` with one immutable initial record per farm (`UNIQUE(farm_id)`), amount, owner/application reference, capture actor, timestamp, and provenance (`new_onboarding` or `legacy_snapshot`). It is effective only when the farm is active.

- New onboarding captures the amount once in `pending_setup`; approval activates it in the same transaction as farm activation.
- Later adjustments use the approved correction path and create new cashbook events; the initial record remains unchanged.
- Rebuild the dashboard cash balance as: effective initial opening record + cashbook inflows − outflows + approved, linked adjustment events. Pending/rejected requests do not participate.
- Remove the opening cash column from ordinary farm responses. After every caller is migrated, drop or permanently deprecate `farms.opening_cash_balance_kes`. Revoke broad authenticated farm-row updates; use scoped application/metadata RPCs instead.

### Paid total and historical correction handling

The new authoritative paid total is sale payments minus approved sale refunds. No correction table contributes to paid totals.

Historical `corrections.paid_kes_delta` rows must be preserved, but they cannot be automatically reclassified as cash. Before the production migration:

1. Run a read-only reconciliation query against a backup/approved export, grouped by correction, sale, farm, and existing payments/cash entries.
2. Store every non-zero legacy delta and its source IDs in a new `legacy_financial_reconciliation` table without changing or deleting the original correction.
3. Match a delta to actual receipt/refund evidence only when supported by a payment reference or approved source record; create linked legacy payment/refund events only after reconciliation.
4. Keep unmatched deltas visible as **unreconciled historical adjustments**, not as cash or paid totals. Display the resulting variance separately; do not silently keep them in authoritative `paid_kes` or silently drop their amount from history.
5. Backfill legacy cash in/out correction deltas as immutable, explicitly classified legacy cash events so the cash balance does not jump during cutover.

The repository has no production snapshot or paid-correction evidence, and no farm audit history for prior opening-balance edits. This assessment cannot determine how many legacy rows exist or whether any represent actual receipts/refunds. Production reconciliation is a mandatory cutover gate.

## 5. Proposed audit-event authorization

Keep the existing raw `audit_events` append-only. Revoke direct `SELECT` from `authenticated`; RLS alone cannot redact its `old_data`/`new_data` JSON.

Add:

- A controlled event-category map for operational, financial, inventory, employee, and farm-governance events.
- A safe, paginated `get_farm_audit_page` RPC that checks active membership and audit permission, applies event-category rules, and returns only explicitly allow-listed fields. Redaction uses allow-listed projections, not a blacklist of JSON keys.
- An append-only `audit_access_events` table written by the read RPC for sensitive audit reads/exports. It stores actor, farm, requested scope, time, request ID, and result count, but not returned payloads. Owner-only access to this access log avoids exposing another staff member's audit-read history.
- A separate append-only `platform_audit_events` table for application decisions, farm lifecycle changes, administrator bootstrap changes, and technical governance events. It has no tenant financial or employee payload.
- An administrative API and export path that call the same filtered audit RPC; no alternate unfiltered export.

Category mapping proposal:

| Role | Visible events |
|---|---|
| Owner | All farm events and full allowed details |
| Manager | Operational and inventory operations needed for management; redact financial amounts/references and employee-sensitive fields |
| Accountant | Financial events and finance fields only |
| Attendant | None |
| Veterinarian | None |
| Inventory officer | Inventory/stock events only; redact financial and employee-sensitive fields |
| Platform administrator | Platform governance/technical audit events only; no farm audit access |

Examples of financial events are sales, sale payments/refunds, cash entries, opening cash, and financial correction decisions. Inventory events include inventory items and stock movements. `feed_deliveries` may be both operational and inventory; the RPC must apply the narrowest field projection. Memberships, staff invitations, reservations, and employee details are employee-sensitive and excluded from manager/accountant views unless a separate staff permission is approved.

## 6. Additive migration and deployment plan

Do not edit applied migration files. Implement as a sequenced set of additive migrations after this design is approved:

1. **Preflight and role foundation**
   - Add `inventory_officer` to `farm_role`.
   - Add permission catalog/role defaults and platform-administrator table/functions.
   - Add `farms.lifecycle_status` with existing farms backfilled as `active`.
   - Add application, lifecycle-event, and platform-audit tables and constraints.
2. **Opening cash and subscription lifecycle**
   - Create `farm_opening_cash_records`; backfill one `legacy_snapshot` per existing farm from its current column value.
   - Modify only the new farm-creation path so a pending farm has a pending Starter subscription (no payment required).
   - On approval, activate that same subscription and append one event. Preserve existing active subscriptions/events; do not insert duplicates.
3. **Financial events and correction workflow**
   - Add correction request/decision/effect and refund structures with farm-scoped composite foreign keys, checks, unique application/idempotency constraints, and append-only triggers.
   - Add the legacy reconciliation table and read-only preflight query. Do not auto-convert unexplained historical paid deltas.
   - Update revenue, cash, dashboard, and batch performance projections to exclude pending/rejected requests and derive paid totals from payment/refund events.
4. **RLS, grants, safe audit, RPCs**
   - Add permission helpers and active-farm guards; update policies and every sensitive RPC in the same migration series.
   - Revoke authenticated financial table DML, broad farm updates, raw audit SELECT, and legacy/non-idempotent financial mutation function grants.
   - Grant narrowly scoped SELECT/RPC execution. Keep service-role access out of browser-facing APIs.
5. **Application and onboarding**
   - Replace immediate farm creation with application start/submit/status APIs; add platform review/approve/reject/suspend/reactivate APIs and a minimal protected admin review interface.
   - Update client-side role-aware financial views; add or update financial correction/refund and audit views/exports.
   - Remove financial rows from generic edit/delete routes.
6. **Cutover**
   - Deploy additively, run preflight reconciliation, confirm legacy opening snapshots and paid/cash correction mapping, then apply final grants/policy lock-down and switch report reads.
   - Use a maintenance window or coordinated deployment so old API clients cannot keep using direct writes during the final lock-down.
   - Compare pre/post totals by farm and sale, record approved variances, and retain an operator recovery plan. Do not drop legacy columns/tables until all compatibility checks pass.

The existing farm insert trigger currently creates an active Starter subscription immediately. The design changes it for pending applications only; approval transitions the existing pending subscription rather than inserting another. Existing active farms remain active and their current subscription rows remain untouched.

## 7. Verification plan and acceptance gates

### PostgreSQL CI (disposable PostgreSQL 18)

Extend the existing `security-phase-1a` job with real-schema tests for:

- Authenticated direct INSERT/UPDATE/DELETE denial on each restricted financial table, including opening-cash, refund, correction, and raw audit tables.
- Positive authorized RPCs for each role/action pair in the matrix; explicit manager sale with zero payment succeeds, manager initial payment fails, manager cash/payment calls fail.
- Owner/accountant sale and payment creation atomically creates exactly one cash entry; duplicate idempotency retries return the same record; conflicting payload reuse fails.
- Cross-farm IDs, mismatched farm IDs, unauthorized role, missing/invalid identity, inactive/suspended/pending farm, and non-member RPC attempts fail with no partial rows.
- Corrections pending/rejected do not change totals; owner cannot self-approve; owner can approve manager/accountant requests; duplicate approvals/refunds/reversals do not create duplicate effects.
- Opening cash exactly once, immutable, excluded while pending, effective after activation; approved adjustments included, rejected/pending ones excluded.
- Farm lifecycle transitions are role-checked, idempotent, audited, and cannot duplicate membership/subscription.
- Audit categories/redaction for every role, raw-table SELECT denial, access-log creation, and identical export filtering.
- `SECURITY DEFINER` functions have empty safe `search_path`, explicit grants/revokes, no client-controlled actor fields, and tested cross-tenant guards.
- Failed RPC rollback leaves no partial payment, cashbook, decision, subscription, or audit effect.
- Negative-control broken RLS still fails the detector and fails CI.

### Fresh disposable Supabase Auth/PostgREST

Use a **new project**, not the contaminated Phase 1A.2 project or production. Create synthetic applicants, platform administrators, and farm roles; authenticate real sessions; exercise the new APIs and direct PostgREST attempts; verify database state for every denial/success. Do not log secrets or tokens. The local PostgreSQL test-auth shim does not establish real Auth, JWT, or PostgREST behavior.

The current [Phase 1A.2 report](./FLOCKLEDGER_PHASE_1A_2_SUPABASE_SECURITY_REPORT.md) remains partial (47/49 original assertions; corrected runner not rerun and old test project contaminated). The prior [Phase 1A.1 report](./FLOCKLEDGER_PHASE_1A_1_CI_EXECUTION_REPORT.md) records PostgreSQL 18.6 local replay only (18/18 migrations, 52/52 assertions); it is not hosted Supabase evidence.

## 8. Decisions still required before implementation

The submitted requirements resolve most of the design. These specific edge cases remain open:

1. **Refund initiation:** May manager/accountant/owner initiate a refund request under the correction workflow, with only a different owner approving it? No refund permission was specified separately from payment creation.
2. **Manager staff administration:** Keep invitations, role assignment, and deactivation owner-only (current safest default), or delegate specific actions to managers? If delegated, specify which actions and which roles they may assign.
3. **Suspended-farm reads:** Approve the proposed read-only access for existing members under their role-specific view permissions, while blocking all writes; or require suspension to block all member reads too?
4. **Application fields:** Approve the minimal application fields (farm name, owner profile/email from verified Auth, timezone default, initial opening cash, and optional application note), or specify additional required business/contact/documents. No document upload/storage path currently exists.
5. **First platform administrator:** Approve a manually provisioned `platform_administrators` row by a trusted operator after verifying the Auth user, or specify another bootstrap process. No platform administrator currently exists.
6. **Existing paid corrections:** Approve preserving unmatched `paid_kes_delta` rows as visible unreconciled history but excluding them from authoritative paid/cash totals until evidence is reviewed? This avoids fabricating receipts but can change current reported balances. Production data has not been inspected.
7. **Reapplication after rejection:** Approve a new application attempt by the same applicant with the old rejection retained, or require platform-administrator reopening before resubmission?

## 9. Approval boundary

This document is the exact proposed design for review. No application, migration, policy, environment, or database change has been made for Phase 1B.

Implementation should begin only after the owner confirms the open decisions above or explicitly approves the recommended defaults. The initial local and hosted test suites must be created and executed against disposable environments before any security claim is made.
