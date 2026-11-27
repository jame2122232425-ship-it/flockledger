# FlockLedger Phase 1B — Stage 1 Architecture and Risk Assessment

**Assessment date:** 26 November 2026  
**Stage:** 1 — Repository and architecture assessment only  
**Implementation status:** No application source, migration, policy, environment file, or database was changed for this assessment.

## 1. Executive summary

FlockLedger is an established Next.js 16, TypeScript, Supabase, and PostgreSQL application. It has an existing multi-farm schema, farm-scoped roles and RLS, operational records, subscription entitlements and quotas, idempotent API-backed sale/payment/cash/correction calls, append-only sale payments, immutable correction rows, and a working farm dashboard/revenue path. The right direction is to extend the existing system, not rebuild it.

The current platform is not yet a controlled, permission-granular ERP foundation:

- Any authenticated user can create a farm through the public farm API. Two authenticated `create_farm` RPC signatures remain granted, and the signup endpoint remains public.
- Farm owners can update all farm columns under the current RLS policy, including `opening_cash_balance_kes`. There is no farm audit trigger in the reviewed migration definitions to preserve the before/after opening balance.
- Payment totals can be changed by append-only `corrections.paid_kes_delta`, without creating a `sale_payments` transaction or linked cashbook receipt. Revenue/receivable views include this delta; the farm cash balance does not.
- The database still grants authenticated users direct table DML for several financial tables. RLS constrains role and farm, but direct PostgREST writes do not have to use API idempotency keys. Owners/managers also have update/delete policies for sales and cash entries.
- The authorization system is role-enum based, not permission based. It has no platform-administrator or inventory-officer model, no delegated manager staff-administration capability, and no farm-member suspension state. Current SELECT policies allow every farm member to read all member-scoped records, including financial data and audit snapshots.
- Farm and staff lifecycle APIs exist, but the client UI exposes only overview, batches, daily records, revenue, and billing tabs. No frontend call was found for cash-entry or correction APIs; most operational APIs likewise appear disconnected from the current application UI.
- Phase 1A.2 remains formally open. Its prior hosted run was partial, had two harness expectation failures, and did not clean up the disposable project. The corrected suite was not rerun.

The initial farm creation function does perform its database work in a transaction: it inserts the farm and owner membership, while an `AFTER INSERT` trigger creates the Starter subscription and event. This is a useful foundation to preserve. However, the entry point is not restricted to controlled platform onboarding, and opening cash is currently an editable farm attribute rather than a historical financial transaction.

**Recommendation:** Extend the current application and selectively refactor financial writes, authorization, onboarding, and lifecycle boundaries. Do not start a broad rewrite or a full accounting engine. Stage 2 should agree the permission matrix and correction/approval rules before any migrations or UI are implemented.

## 2. Assessment method and evidence status

Inspected the repository README and deployment checklist; current source routes and client components; all 18 tracked migration filenames and relevant schema, policy, trigger, function, grant, and view definitions; financial and subscription tests; the current CI workflow; and the prior Phase 0 / Phase 1A reports. No `.env.local` values were read. No production or hosted database was contacted. No tests were run during this Stage 1 assessment.

Evidence labels used below:

- **Source-verified:** present in current tracked source or migrations. This verifies what the repository declares, not what is deployed.
- **Prior execution report:** an earlier report records execution in its stated isolated environment. It is not a new execution in this assessment.
- **Unverified:** depends on current hosted Supabase configuration, live migration state, or an end-to-end test not completed.

The workspace already contained unrelated changes before this assessment: a modified `.github/workflows/ci.yml` and untracked reports/test directories. They were preserved.

## 3. Current architecture

```text
Next.js App Router / React client components
             |
             | same-origin /api requests using Supabase cookies
             v
Next.js Proxy + route handlers
             |
             | Supabase SSR client / authenticated RPCs and queries
             +----------------------------+
             |                            |
             v                            v
       PostgREST / RPC              Auth Admin client
             |                     (server-only service role)
             v
     PostgreSQL RLS, functions, constraints,
     triggers, views, and subscription data
```

### Application and data access

- The application uses Next.js 16 App Router route handlers; no `"use server"` server-action modules were found under `src`.
- `src/lib/supabase/server.ts` creates a cookie-backed SSR client; `src/lib/supabase/admin.ts` is marked `server-only` and creates the Auth Admin client with the service-role key.
- `src/proxy.ts` checks Supabase identity for protected `/api/*` routes, blocks `force_password_change` accounts from those routes, validates same-origin mutations, and attaches request IDs.
- Route handlers commonly validate request bodies with Zod, authenticate with `auth.getUser()`, and use direct Supabase table operations or database RPCs. RLS remains a central authorization layer.
- `flockledger-app.tsx` is a large client-side application coordinator. Revenue is separated into `revenue-page.tsx`; batch and daily views are in `farm-list-pages.tsx`. Business logic is not consistently separated into domain services.
- The README documents more operational endpoints than the current client UI exposes. A repository search found no client calls to `/api/cash-entries` or `/api/corrections`, and the current application tab type contains only overview, batches, daily, revenue, and billing.

### Database footprint

There are 18 migrations, from the initial farm/operations schema through subscriptions, atomic quotas, and generated payment references. They define farms and memberships; batches and poultry records; sales, sale payments, cash entries and corrections; inventory and operational tables; audit events; subscription plans, entitlements, reservations and events; helper functions, RLS, triggers, views and indexes.

The schema is KES-specific (`farms.currency` is constrained to KES) and uses `Africa/Nairobi` in date/metric logic. Farm-owned queries and most rows carry `farm_id`; composite foreign keys protect important farm/batch, farm/inventory-item, and farm/sale relationships.

## 4. Financial data flow and integrity assessment

### Existing transaction paths

1. The Revenue UI validates a sale and calls `POST /api/sales` with an idempotency key.
2. The route calls `create_sale_idempotent`, which persists an idempotency record and invokes `create_sale`.
3. `create_sale` inserts the sale and, when there is an initial payment, inserts a `sale_payments` row. The payment trigger creates a linked cashbook income row in the same PostgreSQL transaction.
4. Later payments use `POST /api/sales/{saleId}/payments` and `create_sale_payment_idempotent`; the same append-only payment and cash-entry trigger path applies.
5. Cash entries have a dedicated idempotent API/RPC. Corrections have a dedicated idempotent API/RPC and are appended to `corrections`.
6. The revenue ledger derives paid totals from `sale_payments` plus sale-correction deltas. Farm cash balance is opening cash plus cash entries and cash-entry correction deltas. Batch performance aggregates sales, payments, cash entries, and corrections.

### Existing strengths

- Sale amount is database-generated from quantity/price inputs.
- Numeric constraints reject negative sales/payment/cash amounts; payment validation locks sale/batch rows and prevents overpayment at insertion.
- Sale payments are positive, append-only records with a farm-scoped composite sale foreign key. A trigger creates one linked, immutable cashbook income row.
- The API paths for sales, payments, cash entries, and corrections require idempotency keys and use payload hashes in database RPCs.
- Corrections are append-only, require a reason, identify the creator, and are validated against closed batches and source rows.
- Database transactions make a payment plus its trigger-created cashbook entry atomic.

### Material gaps and inconsistencies

- **Paid corrections are not payment transactions.** `validate_correction()` permits `paid_kes_delta` for an existing sale or a synthetic closed-batch sale adjustment. `batch_performance` and the revenue ledger include the delta in paid totals, but no `sale_payments` row or linked payment cash entry is created. `farm_dashboard.cash_balance_kes` only adds cash-entry deltas. A paid correction can therefore reduce receivables without increasing recorded cash. It is not a refund/reversal workflow.
- **API idempotency is not the only database write path.** The initial migration grants authenticated DML on financial tables; sale payments also have direct `INSERT` permission. Current policies restrict which roles/farms can write, but do not require the API idempotency RPC. The non-idempotent `create_sale` RPC is still granted to `authenticated`. Database-level duplicate protection is therefore incomplete for direct PostgREST writes.
- **Historical rows are mutable for privileged farm roles.** The generic edit route includes `sales` and `cash-entries`. RLS allows owners/managers to update/delete most operational tables, including these financial tables. Closed-batch guards constrain some operations, but open-batch and untagged cash rows remain mutable through authorized database paths. Audit snapshots exist for many tables, but this is not equivalent to an append-only correction or approval process.
- **Opening cash is mutable.** `opening_cash_balance_kes` is a column on `farms`, and the owner update policy covers the row without column-level restrictions. The value feeds the dashboard balance. No farm-row audit trigger was found in the migration trigger list, so an opening-balance edit does not have the same explicit before/after audit trail as audited operational rows.
- **Expenses and costs are not a single financial source.** Ordinary expenses are cash entries; feed delivery prices, health costs, labour/payroll amounts, and asset purchases are separate operational columns without a required cashbook linkage. Duplicate or omitted cost recording is possible without reconciliation.
- **No explicit refund/reversal transaction type or approval workflow exists.** Payment rows are immutable, but the correction model has no `reversal_of` link, refund type, or separate initiator/approver identities. A correction stores one `created_by`.
- **Cashbook and correction UX is incomplete.** Relevant API routes exist, but no client usage was found for the cash-entry or correction routes. The current visible revenue flow records sales and payments; it does not provide a complete cashbook/expense/correction workflow.
- **No accounting ledger is present.** There is no chart of accounts, journal, accounting period close, or signed reconciliation. This is consistent with the stated Phase 3 boundary; it must not be implied by current dashboard metrics.

### Financial conclusion

The current system is adequate as an operational revenue/cash-recording foundation, but it is not yet a reliable accounting source of truth for the requested advanced finance capabilities. Preserve sales, sale-payment, cash-entry, and correction history. Before building more reporting, define one authoritative transaction model and make database write paths enforce its invariants, not only the API routes.

## 5. Identity, permissions, and employee administration

### Current identity model

- `profiles` stores `id`, `full_name`, and creation time; it does not define a global user role.
- `farm_memberships` associates one auth user and farm with one `farm_role`.
- The current enum contains `owner`, `manager`, `attendant`, `accountant`, and `veterinarian`.
- There is no permission catalog or role-permission relation, no platform-admin identity model, and no `inventory_officer` role.
- Most tenant-table SELECT policies use `is_farm_member(farm_id)` for every role. Consequently, every farm member can read sales, cash entries, payments, and audit events unless a route/UI limits what it displays. Those route/UI limits do not protect direct authenticated PostgREST access.
- Insert permissions are role-specific, but updates/deletes commonly grant owner and manager. Employee invitation creation and role changes are owner-only; manager delegation is not implemented.

### Current employee provisioning lifecycle

1. An owner requests a staff seat through `reserve_farm_staff_seat`; the database locks the farm and checks quota and duplicate reservations.
2. The server creates a Supabase Auth account with a temporary password and `force_password_change` metadata.
3. The server generates a setup token, stores its hash through `finalize_farm_staff_invitation`, and returns the setup link and temporary password to the owner.
4. Staff verify the link and temporary password, set a password, consume the token, and call invitation acceptance. Membership is created after invitation acceptance, not at initial account creation.

This is materially improved over the earlier immediate-membership flow. It still spans PostgreSQL and Supabase Auth operations that cannot share one transaction. Compensating actions and expiring reservations handle some failures, but ambiguous Auth outcomes require manual reconciliation and no automated reconciliation job is documented. Provisioning an already-existing Auth email is rejected rather than attaching a pending invitation to that account.

Membership removal exists and retains the Auth account. There is no farm-specific suspended/deactivated membership state or reactivation flow; access is removed by deleting the membership. Invitation and reservation states exist, but they do not provide a complete employee account lifecycle.

## 6. Farm creation, ownership, and lifecycle

- Public self-registration remains available through `/api/auth/sign-up`.
- Any authenticated user can call `POST /api/farms`; the API invokes `create_farm(text, numeric)`.
- The original `create_farm(text)` function remains separately granted to `authenticated`. Both functions validate `auth.uid()` and create an owner membership, but neither restricts farm creation to a controlled platform onboarding authority.
- Farm creation is transactionally composed in the database: the farm and initial owner membership are inserted, and an `AFTER INSERT` trigger creates the Starter subscription and subscription event. A failure in the database operation rolls back the database work.
- There is no farm `pending_setup`, `active`, `suspended`, or `archived` lifecycle field or corresponding authorization policy. Subscription states are billing/entitlement states, not farm access states.
- Owners can use the role-change RPC to grant owner status to another current member. A farm-row lock and last-owner trigger protect against concurrent removal/demotion of the last owner, but there is no distinct ownership-transfer operation or explicit transfer audit event.
- Farm metadata exposes currency/timezone defaults and the opening balance. No comprehensive settings lifecycle or farm-profile management API was found.

## 7. Database, RLS, audit, and production controls

### Existing controls

- `is_farm_member()` and `has_farm_role()` are `SECURITY DEFINER` helpers with `search_path = ''` in the initial migration. Reviewed privileged functions generally set an empty search path and explicitly grant execution.
- Farm ownership and membership policies are database-enforced. S3 revokes direct authenticated insertion/update of memberships; role changes use `update_farm_member_role`. Last-owner protection locks the farm row.
- Composite foreign keys and triggers enforce selected tenant relationships, batch activity constraints, closed-batch immutability, stock validation, append-only sale payments, and append-only corrections.
- `audit_events` records actor, farm, operation, row identifier, timestamp, and before/after JSON for selected tables. Membership changes have their own audit trigger.
- Subscription events are append-only and use `ON DELETE RESTRICT` to retain subscription history.

### Gaps and limits

- Broad member-read policies include financial rows and audit snapshots. Permission-sensitive read policies need a designed role/permission matrix.
- The opening balance and farm profile are not covered by the reviewed row-audit trigger list.
- Database audit events do not include an explicit correction reason or request/correlation ID. Request IDs exist at the API boundary but are not part of the row-audit records.
- Direct DML grants mean some financial security properties, such as idempotency, are API/RPC-path properties rather than universal database invariants.
- No Supabase Storage bucket or policy was found; `compliance_records.storage_path` is only a database field.
- Live deployed migration state, Supabase Auth settings, production secrets, backup/PITR, monitoring, and restore readiness were not inspected.
- The subscription-events `RESTRICT` and immutable trigger prevent deleting a farm with recorded subscription history. That is a deliberate retention choice, but requires a documented archive/retention lifecycle and makes disposable hosted test projects unsuitable for reuse after fixtures are created.

## 8. Production, production/inventory, and reporting architecture

- Batch, daily, health, weight, feed, sale, and inventory rows are farm-scoped; many batch-linked relations use composite farm IDs. The source schema protects important cross-farm joins.
- Batch closure, closed-batch mutation guards, mortality/feed/date checks, stock-balance validation, and append-only corrections provide useful data-quality controls.
- Feed reporting currently has two representations: `feed_deliveries` plus daily-record consumption for the farm dashboard, and inventory `stock_movements` / `inventory_balances` for stock. The farm dashboard feed-on-hand formula does not incorporate inventory stock movements. The authority for feed inventory must be chosen before advanced inventory reporting.
- There are database indexes and bounded list APIs. Revenue uses a database-side cursor function; dashboard/per-batch metrics are database views. No production-scale load certification was found.
- Unit tests cover validation, calculations, security helpers, UI components, and subscription behavior. SQL integration scripts cover subscription and quota lifecycle; the CI workflow provisions PostgreSQL 18 and runs the Phase 1A RLS suite with a negative control.
- The workflow is not an end-to-end Supabase Auth/PostgREST test. The Phase 1A.2 runner is not a GitHub Actions job.
- Deployment documentation identifies Vercel and separate Supabase environments, but backup/PITR ownership, restore drills, monitoring/error reporting, and distributed edge rate limiting remain unresolved.

## 9. Priority risk register

Severity here ranks implementation and governance risk; it does not imply that an exploit or production incident was observed.

| ID | Severity | Risk | Evidence and impact |
|---|---|---|---|
| 1 | HIGH | Unrestricted farm provisioning | Public signup plus authenticated `POST /api/farms` and two granted `create_farm` signatures conflict with controlled onboarding. |
| 2 | HIGH | Opening balance can be rewritten | Owner farm-row updates can change opening cash without an append-only balance adjustment or identified farm audit trigger. Historical cash balances can change retroactively. |
| 3 | HIGH | Financial correction can create paid value without cash | `paid_kes_delta` affects paid/receivable reports but does not create payment history or cashbook income. |
| 4 | HIGH | Historical finance is not uniformly immutable | Owner/manager RLS and the generic edit route permit some sales/cash-entry edits/deletes outside the append-only payment/correction model. |
| 5 | HIGH | Role permissions are too coarse for least privilege | No permission catalog; all members can read financial/audit rows; managers can update/delete broadly; platform admin and inventory officer are absent. |
| 6 | HIGH | Phase 1A.2 security status remains unresolved | Corrected real Auth/API suite has not been rerun; cleanup was incomplete; role/table/RPC coverage remains partial. Do not claim full tenant isolation. |
| 7 | MEDIUM | Provisioning spans non-atomic external and database operations | Compensation and seat reservations exist, but ambiguous Auth outcomes need manual reconciliation; existing Auth users are rejected by the current creation route. |
| 8 | MEDIUM | Financial workflows are disconnected/incomplete in the UI | Cash-entry and correction endpoints exist without client calls found; expenses/cost sources are not reconciled to cashbook transactions. |
| 9 | MEDIUM | Feed inventory has competing sources | Dashboard feed-on-hand and inventory balances use different transaction sources. |
| 10 | MEDIUM | Audit and lifecycle are incomplete | No farm lifecycle or member suspension state; farm settings/opening balance are not shown in the reviewed audit trigger set; no distinct transfer/approval event model. |

## 10. Proposed target architecture (Stage 1 proposal)

This is a proposal for Stage 2 design, not an approved permission or accounting specification.

1. **Keep the shared Supabase/PostgreSQL deployment and farm tenancy model.** Preserve `farm_id`, composite keys, RLS, existing operational tables, quota logic, and the application’s existing Next.js/API structure.
2. **Separate platform identity from farm capability.** Represent platform administration separately and do not infer tenant access from it. Keep each farm membership independent. Store farm role/permission assignments in a normalized, versionable permission model, with centralized server checks and matching RLS helpers.
3. **Define least-privilege permission identifiers from actual routes and data operations.** Distinguish finance view/create/payment/correction/export, staff view/invite/assign/deactivate, production, health, inventory, and reporting actions. The final matrix must explicitly decide whether attendants/veterinarians can view financial/audit data and whether managers may invite or deactivate staff.
4. **Make financial facts append-only.** Continue sale payments as immutable events. Represent refunds/reversals/corrections as linked, reasoned transactions with explicit actor and, if required, approver. Recompute paid/receivable/cash values from transaction facts; do not make a correction-only `paid_kes_delta` a cash receipt. Model opening balance as an initial balance transaction and adjustment events, preserving the original value.
5. **Keep transactions atomic and idempotent at the database boundary.** Route financial operations through trusted RPCs or a database transaction service that applies validation, tenant/role checks, idempotency, and linked ledger/cash effects together. Revoke or constrain raw table writes that bypass those invariants.
6. **Use a controlled onboarding authority.** Public registration and normal farm creation should not independently grant farms. Provision farm, initial owner, default settings, Starter subscription, and audit record atomically from a trusted onboarding workflow. Keep Supabase service-role use server-only.
7. **Model invitations and lifecycle as explicit state transitions.** Preserve reservation/quota logic; bind invitation to email/farm/role, consume one-time token atomically, create membership only after successful acceptance, and add membership suspension/reactivation without deleting historical attribution. For Supabase Auth cross-system steps, use an explicit saga with idempotent compensation and a reconciliation queue/runbook.
8. **Add explicit farm lifecycle independently of billing.** Define pending setup/active/suspended/archived semantics and enforce them in both RLS/RPC and API operations. Do not use subscription status as an implicit suspension policy.
9. **Consolidate operational inventory authority.** Decide whether feed deliveries and inventory movements share one stock ledger, then derive dashboard stock and FCR-related feed totals from an explicitly documented source.
10. **Extend existing audits.** Include sensitive configuration, financial correction, invitation, role, owner-transfer, deactivation, and lifecycle events. Preserve before/after values and reason, actor, farm, resource, and request correlation while preventing ordinary mutation/deletion.

## 11. Proposed migration and implementation sequence

All changes should be additive and data-preserving; do not edit an already-applied migration.

1. **Security verification gate:** retire the previously contaminated hosted test project and create a fresh disposable project. Rerun the corrected Phase 1A.2 tests, then add coverage for direct table writes, financial read permissions, opening balance, corrections, invitation completion, and lifecycle/RPC paths. Keep PostgreSQL-native and real Auth/PostgREST results distinct.
2. **Permission and lifecycle design:** approve the role-permission matrix, platform-admin boundary, manager delegation, farm suspension semantics, and ownership-transfer rules before changing RLS.
3. **Financial model design:** define payment reversal/refund, paid correction, opening balance correction, actor/approver and cashbook effects. Reconcile how existing `paid_kes_delta` rows map into the new immutable transaction model before writing migrations.
4. **Database foundation:** add permission/lifecycle structures and transactional financial/event primitives. Add constraints, indexes, policies and grants with compatibility tests. Avoid exposing new permissive policies before the new authorization path is complete.
5. **Controlled onboarding and employee lifecycle:** route farm creation through the approved platform provisioning authority; preserve starter subscription/quota behavior; implement invitation acceptance/reconciliation and member deactivation using explicit states.
6. **API and UI integration:** make the client use the centralized permission service; add the missing cashbook/correction workflows; provide loading, denial, and recovery states; preserve current batch, daily, sales, and billing flows.
7. **Data migration/reconciliation:** backfill permission defaults and initial-balance events, reconcile sales/corrections/payment/cash totals, and verify totals before switching reads. Preserve old records and an auditable rollback/forward-recovery plan.
8. **Verification and rollout:** run unit/type/lint/build checks, PostgreSQL migration/RLS tests, authenticated Supabase API tests, concurrency/rollback tests, role matrix, financial reconciliation, and an isolated restore drill. Deploy only after test-project results and migration state are reviewed.

## 12. Phase 1A.2 dependencies and unresolved questions

### Explicit dependency

The current [Phase 1A.2 report](./FLOCKLEDGER_PHASE_1A_2_SUPABASE_SECURITY_REPORT.md) records 47/49 assertions passing in the original run, two status-expectation failures (denied writes returned 409 and left no row), an updated but unrerun test runner, incomplete cleanup, and a hosted connection failure during a later cleanup attempt. The test project should be retired rather than reused.

The prior [Phase 1A.1 execution report](./FLOCKLEDGER_PHASE_1A_1_CI_EXECUTION_REPORT.md) records a local PostgreSQL 18.6 replay with 18/18 migrations and 52/52 SQL assertions passing, plus a negative control. It explicitly does not establish real Supabase Auth, JWT, PostgREST, or complete policy behavior. GitHub Actions itself was not run.

Therefore:

- Phase 1A.2 is **not passed or closed**.
- Do not claim complete tenant isolation or hosted Auth/API security.
- Changes to RLS, role assignment, farm provisioning, or privileged RPC grants require fresh disposable Supabase Auth/PostgREST tests.
- No current hosted project identity, deployed migration state, production data, Auth settings, or production configuration was verified in this assessment.

### Decisions needed for Stage 2

The following are business/security policy decisions, not safe implementation guesses:

1. Which staff roles may see sales, balances, payment history, audit events, and exports?
2. May managers invite staff, assign roles, or deactivate memberships? If yes, which roles and permissions are in scope, and must owners approve them?
3. Is ownership transfer a two-party confirmation, a current-owner-only operation, or an administrator-assisted process?
4. Which financial corrections require a second approver, and which roles may record refunds/reversals?
5. Should controlled onboarding be invitation-only, platform-admin provisioned, or allow owner application/request followed by approval? Should public sign-up be disabled immediately or only after a replacement flow is ready?
6. What should suspension/archive do to read-only access, subscriptions, staff, and financial history?
7. Should existing Auth accounts be attachable to an owner-created invitation, and what verification must be required?

## 13. Stage 1 outcome

Stage 1 assessment is complete. The repository has reusable tenant, quota, append-only payment, correction, and subscription foundations, but financial correction semantics, permissions, farm provisioning, opening balance history, and lifecycle controls need designed changes before implementation.

**No implementation has started.** Stage 2 should resolve the listed policy decisions and produce the final permission matrix, transaction lifecycle, onboarding lifecycle, schema/API changes, tests, and rollback plan before Stage 3 begins.
