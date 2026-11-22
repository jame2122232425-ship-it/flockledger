# FlockLedger

FlockLedger is a multi-farm poultry record system built with Next.js, Supabase, and PostgreSQL. Currency is KES and the default farm timezone is Africa/Nairobi.

## Local setup

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable/anon key.
   Staff provisioning also requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Keep this key server-only and never expose it with a `NEXT_PUBLIC_` prefix.
3. Apply every SQL migration in `supabase/migrations` in filename order to a Supabase project. Apply new migrations once; do not rerun an earlier migration against an existing project.
4. Run `npm run dev`.

The application does not use a service-role key. Requests use the signed-in user's Supabase session, and PostgreSQL Row Level Security enforces farm membership and role permissions.

## Frontend

The responsive web experience includes email sign-in/sign-up, farm setup, and farm switching within one account. A user can own or belong to multiple farms; the selected farm controls the dashboard, batch list, daily records, revenue ledger, and farm-scoped operations. The Revenue screen filters sales and adjustment entries by date, batch, payment status, and buyer; authorized users can record sales and append dated payments, which are linked to cashbook income automatically. The selected farm is restored after refresh when the user still has access. Daily logs are unique per batch/date; farm owners/managers can update an existing log, with changes audited. Sign-up follows the Supabase project's email-confirmation setting. Forms submit to the authenticated API routes above; all farm data access remains enforced by database RLS.

## API

All data endpoints require a signed-in Supabase user. Farm-scoped requests take a UUID `farmId`; database policies enforce membership and roles.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/sign-up` | Create an account |
| POST | `/api/auth/sign-in` | Sign in with email and password |
| POST | `/api/auth/sign-out` | End the current session |
| GET | `/api/farms` | List all farms the signed-in user belongs to |
| POST | `/api/farms` | Create another farm with optional opening cash balance; creator becomes its owner |
| GET, POST, PATCH, DELETE | `/api/farms/:farmId/members` | Manage farm membership and roles (owner-only changes) |
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

`GET /api/sales` accepts `farmId` plus optional `from`, `to`, `batchId`, `paymentStatus` (`paid`, `partial`, or `unpaid`), and buyer `search` filters. Its `summary` totals use the same filtered rows. Record a payment with `{ "farmId": "<uuid>", "paymentDate": "YYYY-MM-DD", "amountKes": 100, "reference": "optional" }` at `/api/sales/:saleId/payments`; `paidKes` on sale creation records an initial payment transaction. Batch-filtered cash-entry requests include linked sale receipts.

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
