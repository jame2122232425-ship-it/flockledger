# FlockLedger - Phase 0 Comprehensive Technical Audit

Audit date: 2026-11-26  
Repository: `jame2122232425-ship-it/flockledger`  
Audit scope: repository source, Supabase migrations, API routes, frontend modules, tests and CI configuration  
Constraint status: audit-only; no application source, migrations, RLS policies, environment variables or production data were changed

## 1. Executive summary

FlockLedger is a substantial and visibly maturing Next.js/Supabase poultry operations application. It has a coherent tenant model, role-bearing memberships, database RLS, append-only sale-payment records, closed-batch protections, idempotent financial writes and subscription quota RPCs.

The strongest verified implementation areas are:

- Authentication is delegated to Supabase Auth and server routes consistently call `auth.getUser()`.
- Tenant isolation is primarily enforced at PostgreSQL level by `farm_id` and RLS membership functions.
- Most operational tables have SELECT, INSERT, UPDATE and DELETE policies tailored to roles.
- Staff accounts are not granted membership until setup acceptance; the implementation uses reservations and compensation logic.
- Sale creation, payments, cash entries and corrections use idempotency records.
- Batch, stock and closed-record database triggers impose important domain constraints.
- The current CI workflow passes type-checking, linting, 65 Vitest tests and the Next.js production build.

The main gaps for advanced centralized ERP use are:

- Public self-registration is still enabled and controlled farm onboarding is not implemented.
- There is no delegated employee-administration permission model. Employee administration remains owner-only, and there is no account suspension/deactivation workflow.
- RLS and tenant isolation have not been executed in this audit against an authenticated two-farm test fixture.
- Financial corrections can change sale paid totals independently of actual `sale_payments` and cashbook entries.
- The mutable farm opening-cash balance is not protected by a correction or audit workflow.
- CI does not run the available disposable-database SQL suites or any cross-tenant RLS tests.
- The repository has no implemented backup/PITR plan, monitoring, alerting, WAF/rate limiting or error-reporting configuration.
- The schema is a farm-centric operations model, not yet a ledger with accounts, journals, posting periods or reconciliations.

**Overall Phase 0 recommendation:** partially redesign for security/accounting readiness, and extend the existing application where it has stable operational foundations. Do not treat the current code as a complete ERP baseline for migration to general accounting or delegated management.

## 2. Existing architecture overview

### 2.1 Verified application stack

- Next.js 16 App Router, React 19 and TypeScript.
- Supabase SSR for server sessions and Supabase Auth.
- Supabase PostgreSQL, RLS and database RPCs.
- Zod for API input validation.
- Vitest and Testing Library for local tests.
- GitHub Actions CI for type-check, lint, tests and build.
- Vercel is the documented deployment target, but no deployment is present in this repository.

Evidence:

- [package.json](/C:/Users/SELLECTOR/Desktop/project/package.json)
- [src/lib/supabase/server.ts](/C:/Users/SELLECTOR/Desktop/project/src/lib/supabase/server.ts)
- [src/proxy.ts](/C:/Users/SELLECTOR/Desktop/project/src/proxy.ts)
- [.github/workflows/ci.yml](/C:/Users/SELLECTOR/Desktop/project/.github/workflows/ci.yml)

### 2.2 Architecture assessment

The application uses a thin-route/thick-database pattern:

- Next.js route handlers authenticate and validate requests.
- Routes call Supabase tables or RPC functions.
- PostgreSQL triggers and RLS perform the final authorization and integrity controls.
- Frontend feature components call JSON APIs and receive farm-scoped data.

This is a reasonable direction for Supabase multi-tenancy, but business rules are distributed across migrations, route handlers and frontend components. There is no documented domain layer or centralized service/repository boundary.

## 3. Verified feature inventory

| Capability | Verified implementation | Main evidence |
|---|---|---|
| Multiple farms | Owners can create and switch farms | [202611210001_initial_schema.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210001_initial_schema.sql), [src/app/api/farms/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/farms/route.ts) |
| Membership and roles | Owner, manager, attendant, accountant and veterinarian enum | Initial migration and RLS loop |
| Farm switching | Frontend persists/validates selected farm | [src/components/flockledger-app.tsx](/C:/Users/SELLECTOR/Desktop/project/src/components/flockledger-app.tsx) |
| Staff provisioning | Reservation, temporary Auth account, setup token and password change | [202611250001_s3_atomic_subscription_quotas.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611250001_s3_atomic_subscription_quotas.sql), [src/app/api/farms/[farmId]/invitations/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/farms/[farmId]/invitations/route.ts) |
| Batches | Creation, close, detail, correction and quota enforcement | Batch routes and quota RPC |
| Daily records | CRUD, uniqueness, role rules and closed-batch guards | [src/app/api/daily-records/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/daily-records/route.ts) |
| Weights/feed/health | Dedicated routes and farm/batch constraints | Initial and guide-operation migrations |
| Sales/payments | Append-only payment history, idempotency and linked cashbook entries | [202611210005_revenue_payments.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210005_revenue_payments.sql) |
| Cashbook | Separate cash entries and batch merging/paging | [src/app/api/cash-entries/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/cash-entries/route.ts) |
| Inventory | Balances, movements and nonnegative-stock trigger | [202611210001_initial_schema.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210001_initial_schema.sql) |
| Operational modules | Biosecurity, house activity, labour, utilities, maintenance and compliance | Guide-operation migration and matching routes |
| Dashboard | Batch performance, farm summary and bounded paging | [src/app/api/dashboard/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/dashboard/route.ts) |
| Subscriptions | Starter/Professional/Enterprise foundation, trial and quota reservation | Subscription migrations and route handlers |

No public checkout, active payment provider or production subscription billing was found.

## 4. Database schema assessment

### 4.1 Tables and relationships

The schema is organized around `farms -> batches -> operational/financial records`, with composite foreign keys where both `farm_id` and `batch_id` or `item_id` must agree. This is a sound cross-tenant integrity pattern.

Verified protections include:

- Batch IDs are unique per farm.
- Daily records are unique per batch/date.
- Stock movement item/batch IDs must belong to the movement farm.
- Sales, stock movements and feed deliveries reference the same farm as their batch.
- Closed-batch insert/update/delete guards exist for operational records.
- Sale payment and linked cashbook entries are append-only or immutable.
- Last-farm-owner removal/demotion is guarded.

### 4.2 Data-integrity risks

1. **Sale paid totals and actual payment/ledger entries can diverge.**  
   The corrections schema and validator allow `paid_kes_delta` independently of `sale_payments` and `cash_entries` (`202611210002_financial_corrections_and_dashboard.sql`, lines 1-19 and 90-127). The idempotent correction RPC inserts only a correction row (`202611220002_phase2_financial_abuse.sql`, lines 241-309).  
   **Risk:** corrected “paid” totals can exist without an immutable payment or cashbook transaction.  
   **Severity:** HIGH.

2. **Opening cash balance is mutable and unaudited.**  
   `farms.opening_cash_balance_kes` is updated by the broad `farms_owner_update` RLS policy, and no farm-audit trigger or immutable correction mechanism was found. Evidence: initial policy in `202611210001_initial_schema.sql` and the column/function in `202611210004_farm_dashboard_summary.sql`.  
   **Risk:** owner/direct database access can rewrite the starting balance used by dashboard cash calculations without append-only evidence.  
   **Severity:** HIGH.

3. **Audit data is not comprehensive for every financial field.**  
   Trigger audit events cover initial tables and membership changes, but linked payment/cash mutations and farm updates have narrower protections. Sale paid corrections remain append-only but do not create an actual accounting counterpart.

4. **Numeric precision is adequate for KES but there is no accounting ledger abstraction.**  
   Numeric fields use 12,2/12,3 scales. This is suitable for cash/weight calculations but does not establish a chart of accounts, posting model or balanced journal.

### 4.3 Indexes and constraints

Phase 3 adds indexes for farm/date paging, batch/cash, sales, corrections and payment lookups. The schema also has unique and foreign-key constraints. Missing SQL result plans and concurrency behavior for the full application dataset remain unresolved.

## 5. Multi-tenant security assessment

### 5.1 Tenant model

The tenant key is `farm_id`. Membership is stored in `farm_memberships(farm_id, user_id, role)`. Every main farm-owned table uses `farm_id`, and composite foreign keys generally include it.

The following database helpers are central:

- `public.is_farm_member(target_farm_id)`
- `public.has_farm_role(target_farm_id, allowed_roles[])`

Both are `SECURITY DEFINER` functions with `search_path = ''` and test membership using `auth.uid()`. This is a strong base.

### 5.2 Cross-tenant access

No verified cross-tenant breach was found in source review. RLS is broad and direct `.from()` queries normally include `.eq("farm_id", ...)`. However, an authenticated user can supply an arbitrary `farmId` to an API route; database RLS/RPC authorization should reject it.

**This cross-tenant behavior was not executed.** No authenticated, disposable two-farm database session test was run in this audit. The repository does contain SQL isolation checks for subscriptions and quota functions, but cross-farm RLS was not run as part of CI.

### 5.3 Significant tenant findings

- **Cross-farm view exposure remains theoretically testable but is not a confirmed vulnerability.** Views use `security_invoker = true`, which is positive. If underlying RLS is correct, cross-farm rows should remain excluded.
- **Some RPCs are intentionally more privileged.** They check `auth.uid()` and the relevant membership/role internally. This is appropriate only if the function logic cannot be abused with a farm or record ID from another tenant.
- **Direct table updates/deletes are filtered only by RLS and route `eq("id", ...)`/`eq("farm_id", ...)` pairs.** This is defensive; no route-level role check should be considered the primary control.

### 5.4 Required tenant tests

For every major farm-owned table and RPC:

1. User A belongs to Farm A.
2. User B belongs to Farm B.
3. User A attempts SELECT/INSERT/UPDATE/DELETE by each table's `farm_id`.
4. User A attempts UPDATE/DELETE of User B's record ID with Farm A or Farm B ID.
5. Repeat at the API layer and direct `authenticated` role SQL.
6. Test manager, attendant, accountant and veterinarian capabilities.
7. Verify no direct service-role key is used by browser code.

No such test was observed passing in the current CI workflow.

## 6. Authentication and authorization assessment

### 6.1 Verified authentication

- Supabase SSR uses HTTP cookies and `auth.getUser()`.
- API proxy blocks unauthenticated protected API paths.
- Public auth endpoints and staff setup endpoints are exceptions.
- Sign-up, sign-in and sign-out routes exist.
- Staff setup requires a setup token and temporary password, then requires the user to change password.

Evidence:

- [src/proxy.ts](/C:/Users/SELLECTOR/Desktop/project/src/proxy.ts)
- [src/app/api/auth/sign-up/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/auth/sign-up/route.ts)
- [src/app/api/staff/setup/verify/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/staff/setup/verify/route.ts)
- [src/app/api/staff/setup/password/route.ts](/C:/Users/SELLECTOR/Desktop/project/src/app/api/staff/setup/password/route.ts)

### 6.2 Employee provisioning

The current provisioning flow is owner-only and substantially hardened:

- Owner membership is checked before reservation.
- Farm staff seat is reserved before Auth creation.
- Auth account is created with `force_password_change`.
- An expiring setup link and reservation are finalized only after Auth creation.
- Setup acceptance consumes the reservation and creates membership.
- Failed finalization compensates by deleting the Auth user and releasing the reservation.

The owner receives both a setup URL and temporary password in the API response. This is operationally convenient but creates a high-privilege credential-distribution boundary. The owner or support channel becomes responsible for both identity proof and password delivery.

### 6.3 Missing delegated administration

No manager employee-admin permission exists. `invitations_owner_insert` and membership owner policies remain owner-only; manager roles cannot provision or remove staff.

**Recommendation:** do not simply expose the existing owner endpoints to managers. Introduce separate permission capabilities such as `staff.invite`, `staff.remove`, `staff.assign_role`, `staff.suspend` and `staff.view`, with explicit denials for owner role changes and sensitive subscriptions. Evaluate each permission independently through a policy table or robust server authorization helper.

### 6.4 Account lifecycle gaps

The repository has no verified account suspension, deactivation, forced sign-out, session revocation, password-reset administration or user reactivation workflow. The only staff lifecycle state is temporary password setup and farm membership removal.

**Severity:** HIGH for production-controlled onboarding.

### 6.5 Privilege escalation findings

No direct owner-role self-escalation path was found in the reviewed source.

Potential risk, but not confirmed:

- A direct authenticated table call could attempt role changes unless RLS's owner-only membership policies and RPC checks remain intact.
- The direct `farm_memberships` update/delete policies are owner-only.
- `update_farm_member_role` performs an owner check and also protects last-owner behavior indirectly.

Required test: User A with manager role attempts every staff route and every membership RPC/table mutation; User A must receive 403/no row.

## 7. RLS policy assessment

### 7.1 Policy coverage

The initial migration enables RLS for core farm tables and creates membership SELECT policies. It creates role-specific INSERT policies and owner/manager UPDATE/DELETE policies. Guide-operation tables receive equivalent policies.

Additional verified policy behavior:

- Sale payments are member-readable and owner/manager/accountant insertable.
- Sale payments cannot be updated or deleted.
- Invitations are owner-only.
- Subscription owners read subscription records; staff read entitlements through RPC logic.
- Subscription plan catalog is public through the route and active-plan RLS.
- Audit, correction and reservation tables are revoked from normal roles or inaccessible directly.

### 7.2 RLS risks

- **No live RLS test evidence.** SQL files include some isolation assertions, but the CI workflow never executes them.
- **SECURITY DEFINER functions require regular auditing.** Most set `search_path = ''`, which is good. Search paths and ownership should be verified in a live database; source review alone cannot confirm migration grants or function owners.
- **Security-definer quota and membership functions are numerous.** One grant/authorization omission or a missing internal `auth.uid()` check could become a high-impact escalation.
- **Owner update policy for farms is broad.** It can update all row columns unless application code or a trigger restricts them.
- **Subscription and auth-attempt tables are deliberately inaccessible; only service-role/RPC grants should be used.** Grant state must be confirmed with live database metadata.

## 8. Financial integrity assessment

### 8.1 Sales and payment model

The implementation is stronger than a simple mutable ledger:

- Sale totals are generated/stored from quantity/weight and price basis.
- Legacy `paid_kes` is migrated to `sale_payments` and forced to zero.
- New payments are append-only.
- Each payment automatically creates a linked immutable cashbook entry.
- Idempotency prevents duplicate API replay.
- Payment triggers reject payments above sale/correction-adjusted balance.

Evidence:

- [202611210005_revenue_payments.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210005_revenue_payments.sql)
- [202611220002_phase2_financial_abuse.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611220002_phase2_financial_abuse.sql)

### 8.2 Financial findings

**Finding: correction may alter paid totals without a payment transaction.**  
`validate_correction()` permits `paid_kes_delta` for sales, and `create_correction_idempotent()` creates only a `corrections` row. There is no trigger that creates or adjusts `sale_payments` and no required linked payment/cash entry for positive `paid_kes_delta`.  
**Impact:** outstanding balance and dashboard paid totals can change in contradiction to the append-only payment ledger.  
**Severity:** HIGH.  
**Required remediation:** prohibit `paid_kes_delta` until there is a transaction entry model; or pair every paid delta with a payment/cash record and immutable references in the correction.  
**Required tests:** add correction/payment/cashbook atomicity tests and run a reconciliation query that equals sale corrections and ledger totals.

**Finding: opening cash balance is mutable outside a journal/correction model.**  
**Impact:** dashboard cash and opening reporting can be rewritten.  
**Severity:** HIGH.

**Finding: no chart of accounts or double-entry journals.**  
The `cash_entries.category` field is free text and `category` is not constrained to a typed account. There are no journal headers/lines, debit/credit invariants, periods or balances.  
**Severity:** HIGH for advanced accounting, INFORMATIONAL regarding current MVP scope.

**Finding: no period closure/reconciliation model.**  
There are no accounting periods, posting locks, bank reconciliation records or reconciled balances.  
**Severity:** MEDIUM for current operations, HIGH for a target ERP.

### 8.3 Accounting target feasibility

The existing data can be mapped to migration stubs, but should not become the accounting engine itself. A future design should introduce:

- Account and account-category tables.
- Journal, journal-line, debit and credit columns.
- Transaction/document IDs linking operational events to journals.
- Posting status and accounting-period closure.
- Immutable posted ledger entries.
- Reconciliation records and control totals.
- Vendor/customer party ledgers.
- Signed correction/reversal documents.

The current sales/cash data can remain the operational source, but postings must be generated atomically after operational validation.

## 9. Production and inventory assessment

### 9.1 Production protections

Verified:

- Batch capacity loss/sales totals cannot exceed chicks received.
- Daily-record/batch/date uniqueness exists.
- Daily feed consumed is constrained to nonnegative feed given minus feed left.
- Stock movements reject negative resulting stock.
- Closed-batch activity cannot be inserted or mutated outside corrections.
- Batch close date cannot precede the latest activity date.
- Treatment sales enforce withdrawal periods.

### 9.2 Remaining production risks

- Corrections are constrained, but no reverse-or-replacement workflow exists for every operational record; they are append-only only for closed batches.
- Batch closure has no explicit operational sign-off or snapshot.
- The weight table uses latest sample estimates for running-batch FCR, but no audit snapshot prevents historical metrics changing when a new weight record is added.
- Inventory is item/batch agnostic for valuation; no costing method or purchase-lot ledger is defined.
- Feed deliveries and daily feed consumption are separate tables; no feed variance/reconciliation record exists.
- No production forecast, cost allocation or fixed-asset depreciation journal is implemented.

**Severity:** MEDIUM overall.

## 10. API and frontend assessment

### 10.1 API strengths

- Zod schemas validate major write inputs.
- API routes return consistent JSON error shapes.
- Pagination is bounded in most list endpoints.
- Idempotency keys are required for sales, payments, cash entries and corrections.
- Same-origin and sec-fetch checks exist in proxy.
- Database authorization is repeated by RLS/RPC rather than trusting UI state.

### 10.2 API and frontend weaknesses

- Route handlers have substantial repeated authentication and error handling logic; no shared authenticated service.
- Some mutations are direct table writes, while financial writes use RPCs. A consistent command/repository layer would reduce drift.
- No server-wide CSRF token mechanism exists; same-origin checks provide partial CSRF protection but should be tested with and without Origin/Sec-Fetch-Site headers.
- Idempotency length and payload hashes are checked, but key reuse is scoped to farm and operation and not every route.
- Public signup remains.
- Frontend feature components are split, but [src/components/flockledger-app.tsx](/C:/Users/SELLECTOR/Desktop/project/src/components/flockledger-app.tsx) remains large and stateful.
- Loading/failure states vary; not all routes expose rate-limit or partial-degradation UX.
- Accessibility and responsive design were not browser-exercised. Source has some semantic labels and dialogs, but keyboard, contrast and screen-reader behavior need manual and automated validation.

### 10.3 API route inventory

The repository has routes for auth, farms, memberships, invitations, staff setup, subscription plans/trials/cancellation, batches, daily records, weights, brooding, feed, health, sales/payments, cash, inventory/movements, assets, biosecurity, house/labour/utility/maintenance/compliance, corrections and dashboard.

No route for account deactivation or reactivation was found.

## 11. Performance and scalability assessment

### 11.1 Positive measures

- Bounded pagination helpers enforce 1-100 rows.
- Revenue ledger uses cursor pagination.
- Dashboard uses batched parallel queries.
- Index migration files cover common farm/date and batch lookups.
- Staff and batch quota operations lock/serialize the farm row.
- SQL benchmark scripts cover 10,000 synthetic rows.

### 11.2 Scalability gaps

- No EXPLAIN/production-scale baseline was observed in CI.
- Aggregate dashboard views may become expensive as a large farm accumulates records; materialized summaries or partitioning may be needed.
- Revenue cursor implementation and correction grouping should be load-tested with realistic record counts.
- No cache strategy or stale-while-revalidate policy is documented.
- No queue/background-worker infrastructure exists for receipts, notifications or subscription webhooks.
- No connection pooling configuration or serverless-connection test is documented.
- No API load test or p95/p99 latency target exists.

**Severity:** MEDIUM until production-scale data is available.

## 12. Testing coverage assessment

### 12.1 Executed validation

The following validation passed on 2026-11-26:

- `npm test`: 13 test files, 65 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; Next.js generated 45 static/dynamic routes.

### 12.2 Test coverage

Available tests cover:

- Zod validation.
- Security helpers and same-origin behavior.
- Pagination helpers.
- Editable field allowlists.
- Quota API mocked behavior.
- Revenue totals and receipt formatting.
- Subscription service/entitlements/UI.
- Batch code generation.

### 12.3 Missing or not CI-executed tests

- No database RLS cross-farm test in CI.
- No live authenticated A/B-farm mutation test.
- No privilege-escalation test matrix for all roles.
- No real Supabase Auth integration test.
- No staff setup success/failure/ambiguity compensation test against disposable Auth.
- No financial transaction reconciliation test.
- No sale-payment/cashbook duplicate test in CI.
- No correction/cash reconciliation test.
- No stock, daily-record or closed-batch concurrency test in CI.
- No SQL migration test in CI.
- No API E2E test suite.
- No browser accessibility test.
- No load/latency test.
- No backup restore drill.

SQL suites exist for subscriptions and pagination, but they require manual execution against a non-production database and are not called by GitHub Actions.

## 13. Production-readiness assessment

The repository is production-oriented but not production-certified.

Missing or unresolved:

- Production Supabase project, migrations and backup/PITR confirmation.
- Custom SMTP/rate-limit setup.
- WAF/rate limiting and bot protection.
- Monitoring and error reporting.
- Alerting and incident runbooks.
- Secret rotation and environment separation verification.
- Restore drill.
- Legal/privacy approval.
- Account deactivation and controlled onboarding.
- Database migration rollback/forward recovery plan.
- Production-scale RLS, finance and performance tests.

The deployment documentation is explicit and appropriate, but it is a checklist rather than evidence that the target systems are configured.

## 14. Technical debt register

| Debt | Risk | Recommendation |
|---|---|---|
| Business rules spread across migrations, route handlers and frontend | Inconsistent authorization and drift | Create explicit domain/application services and contract tests |
| Large stateful frontend component | Maintenance, testability and UX regressions | Split by feature/router; preserve server boundaries |
| Direct table mutations beside RPC mutations | Audit and validation inconsistency | Standardize commands for financial and privileged writes |
| Free-text financial categories | Reporting inconsistency | Add typed accounts/categories |
| Public signup | Not compatible with future controlled onboarding | Add invitation-only mode and remove public signup after migration |
| No account lifecycle | Security/offboarding weakness | Add suspend/deactivate/reactivate and session revocation |
| No live RLS test database | Highest tenant-risk blind spot | Add ephemeral Supabase/Postgres test job |
| SQL suites not in CI | Migration regressions | Run disposable DB migration suite on pull requests |
| No observability configuration | Slow incident detection | Add structured logs, request IDs, metrics and alerting |
| Dashboard aggregation views | Scaling risk | Add summary tables/materialized refresh or incremental aggregates |

## 15. Prioritized security and engineering findings

### CRITICAL

No immediate, verified CRITICAL vulnerability was found in source review. This conclusion is limited by the absence of a live authenticated Supabase test database.

### HIGH

1. **Correction can create paid totals without real payment/cash transactions.**  
   Evidence: [202611210002_financial_corrections_and_dashboard.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210002_financial_corrections_and_dashboard.sql), [202611220002_phase2_financial_abuse.sql](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611220002_phase2_financial_abuse.sql).  
   Remediation: require atomic journal/payment/cash counterparts or remove paid correction capability.  
   Tests: reconciliation and rollback tests.

2. **Opening cash balance is mutable and unaudited.**  
   Evidence: `farms_owner_update`, `opening_cash_balance_kes`.  
   Remediation: create append-only opening-balance journal/correction and owner-only action.  
   Tests: direct SQL update attempts and audit tests.

3. **No account suspension/deactivation/offboarding workflow.**  
   Evidence: no route or migration for suspension; repository search only found staff password flag.  
   Remediation: add account state and session revocation before controlled onboarding.  
   Tests: suspended user API/direct SQL access matrix.

4. **Delegated managers cannot safely receive employee-administration permissions because granular capabilities are absent.**  
   Evidence: membership/invitation policies remain owner-only.  
   Remediation: implement explicit permission capabilities and test owner-only boundaries.  
   Tests: manager privilege matrix.

5. **Live RLS/cross-farm security is unverified.**  
   Evidence: CI does not run SQL RLS suites.  
   Remediation: add disposable database RLS tests.  
   Tests: all roles/tables/RPCs across two farms.

### MEDIUM

1. Public signup remains enabled.
2. Setup token is passed in URL query and temporary credential is returned in API response.
3. Direct RLS table mutations increase the blast radius of policy bugs.
4. SQL migration suite and live Auth compensation tests are not CI-integrated.
5. Dashboard aggregation performance is not production-baselined.
6. No observability, backup/PITR or restore evidence.
7. No accessibility/browser automation.
8. Free-text financial categories are not accounting accounts.
9. No accounting periods or reconciliation state.

### LOW

1. Route-handler repetition and duplicated error logic.
2. Large frontend component.
3. Some legal pages contain draft copy.
4. Marketing and application behavior are not separated as deployable modules.

### INFORMATIONAL

1. Currency and timezone defaults are KES/Africa/Nairobi.
2. Subscription foundation is correctly isolated from paid checkout.
3. Next.js build and static route compilation pass.

## 16. Recommended target architecture

The target architecture should retain:

- Centralized Next.js application.
- Supabase Auth and PostgreSQL.
- `farm_id` on every tenant-owned row.
- RLS as the database-level policy layer.
- SECURITY DEFINER only for narrow, audited RPC operations.
- Append-only operational documents and audit events.

Add:

1. A tenant context object with verified membership and permission claims.
2. Explicit permission capabilities rather than role checks embedded everywhere.
3. A server application-service layer for account lifecycle and domain commands.
4. Operational transactions and a separate accounting posting layer.
5. Immutable journal entries linked to operational source IDs.
6. Background jobs for email, notifications, webhooks and aggregation.
7. Outbox/event tables for reliable external side effects.
8. Metrics, structured logs and distributed request IDs.
9. Separate local/staging/production Supabase projects.
10. A migration test database in CI.

## 17. Proposed database changes

No changes are implemented in this audit. Recommended future migration categories:

1. Add permission and role-permission tables.
2. Add account state, suspension reason and session revoke time.
3. Restrict farm owner updates by column; add farm settings audit.
4. Replace mutable opening-cash balance with posted opening journal or opening-balance correction documents.
5. Rework sale corrections so paid and cash changes are represented by payment/cash transaction IDs.
6. Add chart-of-accounts, journal headers/lines and posting periods.
7. Add party/customer/supplier ledgers and AR/AP documents.
8. Add reconciliation headers and matched source lines.
9. Add immutable batch snapshots and accounting-period snapshots.
10. Add tenant-level composite indexes and query-plan test expectations.
11. Add database migration metadata assertions and RLS test fixtures.

## 18. Proposed implementation roadmap

### Phase 1: Security baseline

- Disposable two-farm RLS suite.
- Two-farm API suite.
- Role and permission matrix.
- Account suspend/deactivate/reactivate.
- Controlled onboarding mode.
- Remove public signup after cutover.
- Add staff invitation revoke and session revocation.

### Phase 2: Financial integrity

- Freeze/reconcile sale paid totals.
- Design a double-entry posting model.
- Remove or redesign paid/cash corrections.
- Add typed cash categories/accounts.
- Add immutable reversal/correction documents.
- Add AR/AP and reconciliation foundations.

### Phase 3: Operational consistency

- Batch snapshot/closure workflow.
- Inventory lot/cost layer.
- Feed variance and production variance reports.
- Standardized correction documents.
- Background jobs and outbox.

### Phase 4: Scale and production

- Database load tests and EXPLAIN baselines.
- Summary tables/materialized dashboards.
- Monitoring, alerting and error reporting.
- Backup/PITR and restore drills.
- WAF, abuse protection and audit log retention.
- CI migration and live-disposable database tests.

## 19. Outstanding risks and unresolved questions

- Can Supabase migration ownership/grants be independently verified in the target database?
- Which role will administer tenants before public registration is removed?
- Should managers receive staff administration, and if so, which staff roles are allowed?
- Can an owner ever delegate deactivation or owner-role assignment?
- Are historical sale-payment/correction records financially reconciled?
- Should opening cash be migrated to a journal or remain an opening-balance snapshot?
- Is every farm required to use KES only, or should multi-currency be introduced?
- What backup/RPO/RTO objectives apply?
- Who owns incident response and account closure/privacy requests?
- What performance volume should Phase 0 target: active farms, batches, records and concurrent users?

## 20. Final assessment

### A. Overall architecture maturity

**Moderately mature monolith.** Strong database-centric foundations exist, but domain boundaries and controlled ERP lifecycle features are incomplete.

### B. Security maturity

**Moderate; not fully certified.** RLS and role policies are extensive and staff provisioning is carefully designed. The lack of live tenant tests, account deactivation and delegated permissions prevents a high-confidence security maturity rating.

### C. Financial integrity

**Partial accounting integrity.** Sale/payment and cashbook protections are meaningful, but corrected paid totals can diverge from transaction records and no journal/accounting-period model exists.

### D. Multi-tenant readiness

**Partially ready.** Tenant keys and RLS are strong foundations, but cross-farm tests must pass in CI before production multi-tenancy is certified.

### E. Production readiness

**Not yet production-certified.** CI/build quality is good, but database migration validation, live RLS/Auth tests, backups, monitoring and deployment evidence are missing.

### F. Top 10 engineering priorities

1. Execute and automate authenticated two-farm RLS tests.
2. Reconcile sale-payment corrections into real transaction records or prohibit paid deltas.
3. Move opening cash to an audited correction/journal mechanism.
4. Implement account suspension, deactivation and session revocation.
5. Implement explicit delegated employee-administration permissions.
6. Convert public signup to controlled invitation/onboarding mode.
7. Add SQL migration testing to CI.
8. Establish chart-of-account and journal foundations.
9. Add monitoring, backup/PITR and restore evidence.
10. Load-test dashboard, sales and cashbook queries at realistic scale.

### G. Recommended sequence

1. Security and tenant test baseline.
2. Account lifecycle and delegated permission model.
3. Financial transaction reconciliation.
4. Accounting model foundation.
5. Operational snapshot/correction redesign.
6. Production observability and recovery.
7. Scale/load testing.
8. Public onboarding cutover.

### H. Extend, refactor or redesign

**Extend and selectively refactor.** Preserve the Next.js/Supabase core, RLS tenant model, append-only payments and quota RPCs. Refactor around explicit permissions, domain services and accounting transactions. Partially redesign the financial schema before adding advanced accounting; do not perform a greenfield rewrite of all operational modules.
