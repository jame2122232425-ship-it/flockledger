# FlockLedger

FlockLedger is a multi-farm poultry record system built with Next.js, Supabase, and PostgreSQL. Currency is KES and the default farm timezone is Africa/Nairobi.

## Local setup

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable/anon key.
3. Apply every SQL migration in `supabase/migrations` in filename order to a Supabase project. Apply new migrations once; do not rerun an earlier migration against an existing project.
4. Run `npm run dev`.

The application does not use a service-role key. Requests use the signed-in user's Supabase session, and PostgreSQL Row Level Security enforces farm membership and role permissions.

## Frontend

The initial responsive web experience includes email sign-in/sign-up, farm selection and setup, a farm dashboard, batch listing/creation, and daily-record listing/creation. Daily logs are unique per batch/date; farm owners/managers can update an existing log, with changes audited. Sign-up follows the Supabase project's email-confirmation setting. Forms submit to the authenticated API routes above; all farm data access remains enforced by database RLS.

## API

All data endpoints require a signed-in Supabase user. Farm-scoped requests take a UUID `farmId`; database policies enforce membership and roles.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/sign-up` | Create an account |
| POST | `/api/auth/sign-in` | Sign in with email and password |
| POST | `/api/auth/sign-out` | End the current session |
| GET | `/api/farms` | List farms for the signed-in user |
| POST | `/api/farms` | Create a farm with optional opening cash balance; creator becomes owner |
| GET, POST, PATCH, DELETE | `/api/farms/:farmId/members` | Manage farm membership and roles (owner-only changes) |
| GET, POST | `/api/batches` | List or create batches |
| POST | `/api/batches/:batchId/close` | Close a running batch |
| GET, POST | `/api/daily-records` | List or create daily house records |
| GET, POST | `/api/weights` | List or create weekly weights |
| GET, POST | `/api/brooding-observations` | Record brooder/house temperatures, humidity, chick behavior, and actions |
| GET, POST | `/api/feed-deliveries` | List or record feed deliveries |
| GET, POST | `/api/health-records` | List or record vaccinations, treatments, and post-mortems |
| GET, POST | `/api/sales` | List or record sales |
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

Batch IDs are permanent uppercase labels containing `BR` or `KJ`, such as `RPF-BR-2611-01` and `RPF-KJ-2611-01`. They must be unique within a farm.

## Data rules

- Feed consumed is calculated as feed given minus feed left over after feeding, never below zero. Remaining store stock is tracked separately in inventory.
- FCR is feed consumed divided by live-weight output. Running batches use sold live weight plus the estimated weight of living birds from the latest weight sample. Closed batches use live weight sold. If output weight is zero or unavailable, FCR is null.
- Closed batch records are immutable. Owner/manager corrections are append-only and require a reason; the original row is retained.
- Owner/manager edits and deletes to ordinary records are audited. Database policies restrict these changes to those roles, and closed-batch triggers reject mutations regardless of the API caller.
- Closed-batch corrections can adjust mortality/culls/feed, sale quantities/weight/revenue/payments, and tagged cashbook amounts. Corrections are attributed to the authenticated user and timestamped; correction totals are reflected in batch performance.
- PostgreSQL dates store farm activity dates as `DATE` values. All farm data is scoped by `farm_id`.
- RLS allows owners and managers to manage batches; attendants can record daily, weight, feed, and stock activity; veterinarians can add health records; accountants can add sales and cash entries.
- A farm must always retain at least one owner. Memberships are audited, and owners cannot remove or demote the last owner.
