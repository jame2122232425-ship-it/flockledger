# FlockLedger

FlockLedger is a multi-farm poultry record system built with Next.js, Supabase, and PostgreSQL. Currency is KES and the default farm timezone is Africa/Nairobi.

## Local setup

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set the Supabase URL, publishable/anon key, and local app URL. Staff provisioning also requires `SUPABASE_SERVICE_ROLE_KEY`; keep it server-only and never expose it with a `NEXT_PUBLIC_` prefix. `DATABASE_URL` is only for a trusted migration runner and is not needed by the app at runtime.
4. Apply migrations in `supabase/migrations` in filename order to an isolated development or staging Supabase project. Apply each migration once; review and approve production migrations separately.
5. Run `npm run dev`.

Farm data requests use the signed-in user's Supabase session, and PostgreSQL Row Level Security enforces farm membership and role permissions. The owner-authorized staff provisioning flow also uses a server-only Supabase service-role key; never expose it in client-side code or commit it to the repository.

## Frontend

The public marketing site includes the landing page and dedicated Pricing, Guides, FAQ, About, Contact, Blog, Privacy Policy, Terms of Service, and Data Security pages. The three legal pages contain draft copy and require review and approval before publication. Pricing and farm billing read the active subscription catalog; billing is in KES, and unset paid prices are shown as unavailable. The frontend does not provide checkout or collect payments.

The farm app includes email sign-in/sign-up, farm setup, and farm switching within one account. Owners can create farms, provision staff accounts with roles, and provide temporary credentials and a setup link; staff setup links expire after seven days and staff must choose a new password. A user can own or belong to multiple farms; the selected farm controls the dashboard, batch list, daily records, revenue ledger, and farm-scoped operations. The Revenue screen filters sales and adjustment entries by date, batch, payment status, and buyer; authorized users can record sales and append dated payments, which are linked to cashbook income automatically. The selected farm is restored after refresh when the user still has access. Daily logs are unique per batch/date; farm owners/managers can update an existing log, with changes audited. Sign-up follows the Supabase project's email-confirmation setting. Forms submit to the authenticated API routes below; farm data access remains enforced by database RLS.

Run `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build` to type-check, lint, test, and build the project. The GitHub Actions workflow runs these checks on pushes and pull requests using placeholder environment values; it does not deploy or access production secrets.

The deployment target is Vercel with a separate production Supabase project and Supabase's default Auth email delivery. Hosting and database accounts are not configured by this repository. See [docs/deployment.md](./docs/deployment.md) for the deployment and production-readiness checklist.

## API

Except for the public active-plan catalog, data endpoints require a signed-in Supabase user. Farm-scoped requests take a UUID `farmId`; database policies enforce membership and roles.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/sign-up` | Create an account |
| POST | `/api/auth/sign-in` | Sign in with email and password |
| POST | `/api/auth/sign-out` | End the current session |
| GET | `/api/auth/session` | Check whether the current visitor is signed in |
| GET | `/api/farms` | List all farms the signed-in user belongs to |
| POST | `/api/farms` | Create another farm with optional opening cash balance; creator becomes its owner |
| GET | `/api/subscription-plans` | Public read of active subscription plans and configured KES prices |
| GET, POST | `/api/farms/:farmId/subscription` | Read farm entitlements or start its one-time Professional trial (owner-only trial start) |
| GET | `/api/farms/:farmId/subscription/usage` | Read authenticated farm subscription usage; membership is checked by the database |
| POST | `/api/farms/:farmId/subscription/cancel` | Schedule owner-only cancellation at the current trial or billing-period end |
| GET, POST, PATCH, DELETE | `/api/farms/:farmId/members` | Manage farm membership and roles (owner-only changes) |
| GET, POST | `/api/farms/:farmId/invitations` | List invitations or provision a staff account (owner only) |
| POST | `/api/invitations/accept` | Accept pending farm invitations for the signed-in user |
| POST | `/api/staff/setup/verify` | Verify a staff setup link and temporary password |
| POST | `/api/staff/setup/password` | Set a new password for a provisioned staff account |
| GET, POST | `/api/batches` | List or create batches |
| POST | `/api/batches/:batchId/close` | Close a running batch |
| GET, POST | `/api/daily-records` | List or create daily house records |
| GET, POST | `/api/weights` | List or create weekly weights |
| GET, POST | `/api/brooding-observations` | Record brooder/house temperatures, humidity, chick behavior, and actions |
| GET, POST | `/api/feed-deliveries` | List or record feed deliveries |
| GET, POST | `/api/health-records` | List or record vaccinations, treatments, and post-mortems |
| GET, POST | `/api/sales` | Filter revenue rows or record a sale with an optional initial payment |
| GET, POST | `/api/sales/:saleId/payments` | List or record individual sale payments |
| GET, POST | `/api/cash-entries` | List or record farm income and expenses |
| GET, POST | `/api/inventory` | List stock balances or create inventory items |
| GET, POST | `/api/stock-movements` | List or record inventory receipts and use |
| GET, POST | `/api/assets` | List assets or record a purchase |
| GET, POST | `/api/biosecurity-visits` | Record visitor and biosecurity checks |
| GET, POST | `/api/house-activities` | Record litter checks, cleanouts, disinfection, and downtime |
| GET, POST | `/api/labour-records` | Record worker attendance and payroll |
| GET, POST | `/api/utility-usage` | Record electricity, water, and fuel usage |
| GET, POST | `/api/maintenance-records` | Record maintenance and repair activity |
| GET, POST | `/api/compliance-records` | Track licence/compliance metadata and expiry dates |
| GET, POST | `/api/corrections` | List or append owner/manager corrections to closed batches, including sale-payment and cashbook adjustments |
| GET | `/api/dashboard?farmId=...` | Get per-batch performance/KPIs and farm-wide cash, feed, revenue, expense, and receivable totals |
| PATCH, DELETE | `/api/records/:resource/:recordId` | Audited owner/manager edits or deletes for explicitly allowed record fields; requires `farmId` and is limited to open-batch records where applicable |

For `PATCH`, send `{ "farmId": "<uuid>", "changes": { "<camelCaseField>": value } }`. For `DELETE`, pass `?farmId=<uuid>`. Resource names are the corresponding collection names in this table (for example `daily-records` or `health-records`). Farm and batch identity fields, generated totals, correction entries, and audit events are not editable through this endpoint. Batch metadata can be edited, but batch records themselves cannot be deleted.

Most list endpoints accept bounded `page` and `pageSize` query parameters and return pagination metadata with the data. The default page size is 50 and the maximum is 100; the sales ledger uses a 25-row cursor-based page by default. `GET /api/sales` accepts `farmId` plus optional `from`, `to`, `batchId`, `paymentStatus` (`paid`, `partial`, or `unpaid`), and buyer `search` filters. Its `summary` totals use the same filtered rows. Record a payment with `{ "farmId": "<uuid>", "paymentDate": "YYYY-MM-DD", "amountKes": 100, "reference": "optional" }` at `/api/sales/:saleId/payments`; `paidKes` on sale creation records an initial payment transaction. Batch-filtered cash-entry requests include linked sale receipts.

Batch IDs are generated and read-only when creating a batch. The label uses the farm-name initials, `BR` or `KJ`, the placement month (`YYMM`), an optional house token, and the next monthly sequence—for example `RPF-BR-2611-01` or `RPF-BR-A-2611-01`. IDs must be unique within a farm and are never reused.

## Data rules

- Feed consumed is calculated as feed given minus feed left over after feeding, never below zero. Remaining store stock is tracked separately in inventory.
- FCR is feed consumed divided by live-weight output. Running batches use sold live weight plus the estimated weight of living birds from the latest weight sample. Closed batches use live weight sold. If output weight is zero or unavailable, FCR is null.
- Closed batch records are immutable. Owner/manager corrections are append-only and require a reason; the original row is retained.
- Owner/manager edits and deletes to ordinary records are audited. Database policies restrict these changes to those roles, and closed-batch triggers reject mutations regardless of the API caller.
- Closed-batch corrections can adjust mortality/culls/feed, sale quantities/weight/revenue/payments, and tagged cashbook amounts. Corrections are attributed to the authenticated user and timestamped; correction totals are reflected in batch performance.
- Closed-batch correction-added sales appear as adjustment rows dated by the correction's Africa/Nairobi entry date.
- Sale payments are individual, append-only transactions. Each new payment (including an initial payment recorded with a sale) creates a linked cashbook income entry automatically. Existing paid amounts are migrated into payment history without creating duplicate historical cashbook entries. Cumulative payment totals are derived from payment history and sale corrections rather than editable sale fields.
- PostgreSQL dates store farm activity dates as `DATE` values. All farm data is scoped by `farm_id`.
- RLS allows owners and managers to manage batches; attendants can record daily, weight, feed, and stock activity; veterinarians can add health records; accountants can add sales and cash entries.
- A farm must always retain at least one owner. Memberships are audited, and owners cannot remove or demote the last owner.

## Project status and roadmap

### Subscription foundation S1 (implemented; isolated-test database verified)

- `202611240001_subscription_foundation.sql` adds the plan catalog, feature/limit configuration, KES price records, farm subscriptions, payment/invoice/event history, webhook deduplication and usage measurements. New farms receive a Starter subscription; existing farms are backfilled.
- The database-backed API exposes active plans, farm entitlements, the one-time 14-day no-card Professional trial and owner-scheduled cancellation. Staff can read their farm entitlements; only owners can manage the trial/cancellation lifecycle.
- Professional/Enterprise prices remain unset until approved. No checkout, payment provider, client-side successful-payment action or production database deployment is included.
- `past_due` resolves to Starter immediately. `grace_period` retains its plan through `current_period_end`; overdue grace/past-due subscriptions then fall back to Starter when entitlements are next read. Trial expiry and scheduled cancellation are also processed on entitlement reads, preserving farm records and membership.
- `evaluateSubscriptionLimit` is a backend helper only. Existing resource-creation routes are not yet atomically quota-gated, so plan limits must not be treated as enforced until those writes use a database reservation/atomic check.
- Subscription event history is append-only and retained: foreign keys intentionally prevent deleting a farm/subscription while related audit events remain. No farm-delete workflow exists.
- The S1 migration was applied transactionally to the confirmed isolated test database on 24 Nov 2026; it was not applied to production. Its rollback-only SQL integration test passed there. That database has no `supabase_migrations.schema_migrations` history table, so its earlier migration state is not tracked by the Supabase CLI. Reconcile the baseline before using `supabase db push` against that database.
- Run `psql $env:DATABASE_URL --set ON_ERROR_STOP=1 --file "tests\subscription-foundation.sql"` only against an isolated test database after applying the migrations. The script runs in a transaction and rolls back its fixture users and farms.

### Subscription frontend S2 (implemented; no checkout)

- The public Pricing page and farm Billing tab use the active database plan catalog. They display plan features, configured resource limits, KES billing intervals, and the 14-day Professional trial where eligible.
- The public catalog contains only active plans and display fields; it omits internal plan IDs and raw feature configuration. Farm Billing uses authenticated, farm-scoped entitlement and usage APIs. Trial/cancellation actions are visible only to owners and remain authorized by the server/database.
- Trial history preserves the Professional trial start/end dates after expiry through the membership-authorized `get_farm_professional_trial_history` RPC in `202611240002_subscription_trial_history.sql`. Expiry does not reactivate or duplicate a trial, or delete farm data.
- Paid prices are unset and shown as unavailable. No checkout, payment collection, payment provider, or production billing is implemented.
- `GET /api/subscription-plans` is intentionally public and returns only the active display catalog. Farm entitlements and usage remain authenticated and farm-membership scoped.
- Batch and additional-staff limits are informational; their creation/provisioning operations are not yet atomically quota-gated. See [full_report.md](./full_report.md) for the affected operations, a separate backend plan, and verification details.

### Phase 3: Performance and scalability

- Bounded pagination is implemented for the dashboard and operational list APIs; revenue uses database-side cursor paging and batch cash entries are paged after database-side merging.
- Database indexes and paging functions are in migrations `202611220003_phase3_query_indexes.sql`, `202611220004_phase3_revenue_paging.sql`, and `202611220005_phase3_cash_entry_paging.sql`. These Phase 3 migrations were applied to the approved test database, not production.
- The batch, daily-record, and revenue views are split into dynamically loaded feature components.
- The implementation has not been certified under production-scale or concurrent load. See [full_report.md](./full_report.md) for validation results and limitations.

### Phase 4: Production readiness (in progress)

- Added CI checks, a sanitized `.env.example`, and a Vercel-oriented deployment checklist.
- Vercel, a separate production Supabase project, and Supabase's default Auth email delivery are the selected targets; no production account settings or deployments have been changed.
- WAF/rate-limiting and monitoring providers are deferred. The production backup/PITR plan is not yet confirmed. Legal pages still need review and approval before launch.

### Phase 5: Future enhancements

- Accounting-period closure and signed reconciliations.
- Compliance document storage.
- Scheduled dashboards and notifications.
- Mobile/PWA support.
- Multi-currency support; the current database is KES-only.
- Advanced reporting and role-scoped exports.
