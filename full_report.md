# FlockLedger - Comprehensive Codebase, Architecture and Security Audit Report

**Audit date:** 22 November 2026  
**Scope:** FlockLedger source code, Supabase migrations, API routes, frontend, tests and local production build  
**Method:** Static source inspection plus `npm test`, `npm run lint`, and `npm run build`

> This report is evidence-based and does not claim findings that were not reproduced in source or test output.

## 1. Executive Summary

FlockLedger is a substantial Next.js 16 and Supabase application with a broad poultry-recording feature set. The implementation includes Supabase Auth, PostgreSQL RLS, role-specific policies, append-only sale payments, correction records, audit triggers, inventory balance validation, batch closure guards and a multi-part dashboard. The most important confirmed positive design choices are:

- Authentication is checked in server route handlers with `supabase.auth.getUser()`.
- Farm-scoped reads and writes rely on RLS policies rather than only application checks.
- Sensitive administrative operations use a server-only Supabase service-role client.
- The database contains last-owner, closed-batch, negative-stock, cross-farm batch, withdrawal-period and append-only mutation guards.
- Financial values use decimal PostgreSQL columns and the revenue screen rounds to cents.
- Existing tests pass, lint passes and a production build succeeds.

The audit also found serious production-readiness concerns:

1. `.env.example` contains what appears to be a real Supabase publishable key and, more importantly, a real-looking service-role secret. This must be revoked and replaced immediately if these credentials are live.
2. Provisioned staff receive farm membership before setup is completed, and API authorization does not enforce the `force_password_change` metadata flag. A user who knows or obtains the temporary password can operate with the assigned role before changing it.
3. Staff setup invitations are not bound to an authenticated account or verified setup session strongly enough: the setup route uses a token plus temporary password, but the database token is not consumed at verification and invitation acceptance does not check invitation expiration.
4. The application has no confirmed integration tests or RLS test suite against Supabase. Unit tests cover only a limited set of validation and calculation helpers.
5. There is no observable rate limiting, brute-force protection, abuse throttling or idempotency mechanism in authentication and financial mutation routes.
6. The database migrations are broad and mostly non-idempotent. Supabase deployment, migration drift and migration order need manual verification.

**Overall verdict:** Not yet suitable for real farm financial or multi-user operational use until secrets, staff provisioning, security testing and database verification are resolved.

## 2. Project Architecture Overview

FlockLedger follows a Next.js App Router architecture:

- React/Next.js server and client components provide the marketing and farm application UI.
- Route handlers under `src/app/api/**/route.ts` authenticate requests and use Supabase/PostgREST.
- Supabase is initialized through `@supabase/ssr` for server-side cookie sessions and `@supabase/supabase-js` for the service-role administrative client.
- PostgreSQL stores application data and enforces RLS, constraints and triggers.
- Supabase RPC functions perform privileged, multi-step operations such as farm creation and sale creation.
- Client-side React state calls JSON API routes; it does not appear to query Supabase directly from the main farm application.

Primary boundaries:

| Boundary | Implementation |
|---|---|
| Frontend | `src/components/flockledger-app.tsx`, marketing components and App Router pages |
| API | `src/app/api/**/route.ts` |
| Validation | `src/lib/validation/**` and Zod schemas |
| Supabase server session | `src/lib/supabase/server.ts` |
| Supabase administrative client | `src/lib/supabase/admin.ts` |
| Database security | `supabase/migrations/*.sql` |
| Unit tests | `tests/*.test.ts` |

## 3. Actual Technology Stack

The confirmed stack in `package.json` is:

- Next.js `16.4.6`
- React `19.3.0`
- React DOM `19.3.0`
- Supabase SSR `^0.12.7`
- Supabase JS `^2.119.2`
- Zod `^4.6.7`
- Tailwind CSS `4.3.3`
- TypeScript `^5`
- Vitest `^4.1.12`
- ESLint `^9`

The Next.js configuration at `next.config.ts` enables cache components, partial prefetching, an allowed development origin and a CSS Turbopack rule. There are no security headers, CSP configuration or strict `serverActions` configuration in the visible configuration.

## 4. Project Directory and Codebase Analysis

### Application

- `src/app/app/page.tsx` loads the farm application shell.
- `src/app/login/page.tsx` and `src/app/signup/page.tsx` provide authentication pages.
- `src/app/staff/setup/page.tsx` provides temporary-password verification and replacement.
- `src/components/flockledger-app.tsx` contains the main farm UI and API calls.
- Public marketing, blog, guides and legal routes exist in `src/app/**/page.tsx`.

### API

The implemented route inventory matches or exceeds the documented endpoint list:

| Area | Routes |
|---|---|
| Authentication | `/api/auth/sign-up`, `/api/auth/sign-in`, `/api/auth/sign-out`, `/api/auth/session` |
| Farms and staff | `/api/farms`, `/api/farms/[farmId]/members`, `/api/farms/[farmId]/invitations`, `/api/invitations/accept`, `/api/staff/setup/verify`, `/api/staff/setup/password` |
| Poultry operations | `/api/batches`, `/api/batches/[batchId]/close`, `/api/daily-records`, `/api/weights`, `/api/brooding-observations`, `/api/feed-deliveries`, `/api/health-records` |
| Finance | `/api/sales`, `/api/sales/[saleId]/payments`, `/api/cash-entries`, `/api/corrections`, `/api/dashboard` |
| Inventory and assets | `/api/inventory`, `/api/stock-movements`, `/api/assets` |
| Compliance and operations | `/api/biosecurity-visits`, `/api/house-activities`, `/api/labour-records`, `/api/utility-usage`, `/api/maintenance-records`, `/api/compliance-records` |
| Generic edit/delete | `/api/records/[resource]/[recordId]` |

### Database

Six migrations are present:

- `202611210001_initial_schema.sql`
- `202611210002_financial_corrections_and_dashboard.sql`
- `202611210003_guide_operations_records.sql`
- `202611210004_farm_dashboard_summary.sql`
- `202611210005_revenue_payments.sql`
- `202611210006_farm_invitations.sql`

## 5. Implemented Features and Feature Verification

### Confirmed implemented

- Account signup, login, logout and session check.
- Owner-created farms and owner/manager/attendant/accountant/veterinarian role model.
- Staff account provisioning and temporary setup flow.
- Batch creation and closure.
- Daily logs, weights, brooding observations, feed, health and operational records.
- Sales and append-only payments.
- Cash entries and cashbook/sale payment integration.
- Inventory items and stock movement balance validation.
- Closed-batch correction entries.
- Batch and farm dashboards.
- Owner/manager generic edit/delete route for supported resources.
- Audit event tables and many audit triggers.

### Partially or not independently verified

- Actual deployed Supabase configuration and live RLS behavior.
- Email delivery and confirmation behavior.
- Live migration deployment history.
- Staff account setup across Supabase Auth metadata and cookie session behavior.
- Concurrent financial transactions under load.
- Backup, monitoring and production hosting.
- Cross-browser and mobile UI behavior.
- Storage and file-storage permissions; no obvious storage implementation is present.

## 6. Authentication and Authorization Audit

### Authentication implementation

`src/lib/supabase/server.ts` creates a cookie-backed Supabase SSR client. It reads and writes cookies through `next/headers`. API route handlers call `supabase.auth.getUser()` before data access. This is preferable to relying only on cookie parsing or the client token payload.

`src/app/api/auth/sign-up/route.ts`, `sign-in/route.ts`, `sign-out/route.ts` and `session/route.ts` implement the documented auth endpoints.

Positive observations:

- Signup uses Zod validation.
- Sign-in does not reveal a detailed auth failure.
- Logout uses Supabase server sign-out.
- Session checks return generic unauthenticated or success results.

Confirmed concerns:

- No rate limiting or lockout is visible for sign-in or signup.
- Password policy is only eight-character minimum; no breach/password strength policy is visible.
- Sign-in responses include `requiresPasswordChange` but API middleware does not enforce it; the UI must enforce behavior.
- Session lifetime, refresh policy and cookie flags depend on unreviewed Supabase project settings.
- There is no explicit CSRF origin check or centralized auth middleware. Supabase cookie settings mitigate some browser cross-site threats, but this is not a substitute for verified CSRF controls.

### Authorization

RLS helpers `is_farm_member()` and `has_farm_role()` are implemented as `SECURITY DEFINER` SQL functions in `202611210001_initial_schema.sql`, with `set search_path = ''`. This is strong against search-path attacks.

Roles are also enforced in:

- Farm membership RLS policies.
- Resource insert/update/delete policies.
- Database trigger functions.
- Route-level schema and RPC operations.

The generic edit/delete route in `src/app/api/records/[resource]/[recordId]/route.ts` validates field names individually and relies on RLS plus closed-batch triggers.

### Staff provisioning

`src/app/api/farms/[farmId]/invitations/route.ts` is owner-gated at the application layer and database RLS. It:

- Creates an Auth user with email confirmation already enabled.
- Sets both `user_metadata.force_password_change` and `app_metadata.force_password_change`.
- Creates a membership immediately.
- Generates a 32-byte random setup token and stores only a SHA-256 hash.
- Returns the setup URL and temporary password to the owner.

The verify route signs in with the temporary password and checks the force-change flag. The password route updates the password and clears setup metadata.

The setup-token implementation can be improved, and the immediate membership creation is a security defect.

## 7. Supabase and PostgreSQL Security Audit

### RLS

RLS is enabled on the initial sensitive tables, the operational tables added in migration 003 and sale payments/invitations added later. The initial migration creates member-read policies and role-specific insert/update/delete policies for the core tables.

The model is generally farm-scoped:

- SELECT policies use `is_farm_member(farm_id)`.
- Mutations use role checks via `has_farm_role()`.
- Member management is owner-only.
- Corrections are owner/manager insert-only.
- Audit events have member read but no member insert/update/delete policy.

Direct database access for a user should therefore be constrained to the user's memberships and role. This remains unverified without a live Supabase test session.

### SECURITY DEFINER

Security-definer functions found in migrations use `set search_path = ''`, which is appropriate. Functions should still be manually reviewed for:

- Whether every sensitive function validates `auth.uid()`.
- Whether privileged RPCs are revoked from `public` and granted only to `authenticated`.
- Whether `auth.uid()` is used consistently in trigger contexts.

The `create_farm`, `create_sale`, payment trigger and invitation acceptance functions contain the appropriate execute grants or auth checks in most cases.

### Anonymous privileges

Core sensitive tables are revoked from `anon` and only `authenticated` grants are used. The migrations also revoke batch performance and farm dashboard views from `anon`.

### Storage

No Supabase Storage bucket or storage policy was found in the migrations or source. `compliance_records.storage_path` appears to be a text reference only. Storage security is therefore **not implemented or not verifiable**.

## 8. Multi-Farm Data Isolation Audit

The system has multiple independent isolation layers:

- Every farm-scoped route passes `farmId` and every database row includes `farm_id`.
- RLS reads require membership.
- Inserts require matching role membership.
- Composite foreign keys are used for some sale and record relationships.
- Batch, sale and inventory paths validate the farm in foreign keys or route filtering.

The main data tables use composite relationships that prevent cross-farm batch and item joins:

- `sales(farm_id, batch_id)` references `batches(farm_id, id)`.
- `daily_records`, weights and health records use the same composite pattern.
- `stock_movements(farm_id, item_id)` references `inventory_items(farm_id, id)`.
- `sale_payments(farm_id, sale_id)` references `sales(farm_id, id)`.

Remaining risks:

- Application-level route access depends on RLS; a misconfigured live policy could expose rows even though static policy declarations look correct.
- No live RLS test was run because the audit must not modify or query production data.
- Selected-farm persistence is in client storage and may reference a farm that the user no longer belongs to. The API and RLS should reject the stale selection, and the UI should handle that response.

## 9. Database Schema and Integrity Assessment

Positive integrity features:

- UUID primary keys.
- Cascading deletion for high-level farm, profile and membership records.
- Restrict or set-null behavior for business relationships.
- Numeric precision for money and weight.
- Unique batch codes within a farm.
- Unique daily record per batch/date.
- Unique inventory item names within a farm.
- Unique farm/email invitations.
- Check constraints for negative values, status values and date relationships.
- Composite foreign keys for farm/batch and farm/item relationships.
- Append-only sale payments and corrections.
- Batch closing and closed-batch mutation guards.
- Stock balance prevention through `validate_stock_movement()`.
- Last-owner protection.

Potential integrity weaknesses:

- Migration 004 replaces the `create_farm(text)` function by adding a separate `create_farm(text, numeric)` overload. The old overload remains explicitly granted at the end of migration 001 and must be removed or intentionally retained. This can create inconsistent behavior if callers use the old signature.
- `corrections` has `source_table` check constraints that changed across migrations. The live migration state must be checked for the final constraints.
- Multiple migrations use broad `drop policy`/`drop constraint` patterns. Deployment on a divergent or partially applied database could fail or change constraints unexpectedly.
- `audit_events.record_id` is UUID, while some audited records may use UUID in this schema. It is consistent for reviewed tables.
- No migration checksum or formal deployment/rollback process is documented beyond filename ordering.
- Several operational tables allow batch_id to be null and use set-null foreign keys. This is likely intentional for farm-wide records but weakens batch attribution where a tagged batch is expected.
- Some optional numerical fields do not specify upper bounds, allowing values beyond practical operational ranges.
- Concurrency for daily record updates is protected by a database unique constraint, but the route returns a conflict only for relevant inserts. Updates are owner/manager only.

## 10. API Endpoint Audit

### Authentication and authorization

All farm data routes reviewed call `auth.getUser()` or a database operation that is protected by RLS. Exceptions are marketing/static pages only.

Representative findings:

| Endpoint group | Authentication | Authorization | Validation | Findings |
|---|---|---|---|---|
| `/api/auth/*` | Mixed | Public auth operations | Zod | No rate limiting or lockout. |
| `/api/farms` | Required | Owner created via RPC | Zod | Farm creation overload should be reviewed. |
| `/api/farms/[farmId]/members` | Required | RLS and owner operations | UUID and Zod enum | Last-owner and membership guard is database-backed. |
| `/api/farms/[farmId]/invitations` | Required | Owner gate and RLS | Email, role and password Zod | Membership is inserted before setup completion. |
| `/api/staff/setup/*` | Verify then authenticated password change | Force-change metadata | Zod | Token reuse and setup-state enforcement are incomplete. |
| `/api/batches` | Required | Owner/manager insert | Zod | Batch code does not validate the full documented placement sequence. |
| `/api/daily-records` | Required | Role RLS | Zod in route helper | Unique batch/date database constraint. |
| `/api/weights` | Required | Role RLS | Zod in route | Live-estimate behavior depends on latest valid record. |
| `/api/sales` | Required | Accountant/owner/manager | Zod | Financial calculations include cents and corrections. |
| `/api/sales/[saleId]/payments` | Required | Owner/manager/accountant | Zod | Append-only and linked cash entry enforced in SQL. |
| `/api/cash-entries` | Required | Role RLS | Zod | Sale payment entries are excluded from direct editing. |
| `/api/corrections` | Required | Owner/manager RLS | Zod | Append-only with source-type validation. |
| `/api/dashboard` | Required | RLS view access | UUID | No pagination; dashboard is aggregate by farm. |
| `/api/records/[resource]/[recordId]` | Required | Owner/manager RLS | Strict field allowlist | Closed-batch triggers reject mutations. |

### Common response and robustness issues

- Consistent JSON error format is mostly used: `{ error, details? }`.
- Database errors are normally mapped to 400, 403, 409 or 500.
- Unexpected exceptions are logged and converted to generic 500 responses.
- Supabase configuration failures are mapped to 503.
- Most list endpoints lack pagination and server-side row limits.
- No explicit request-id or structured audit logging for API failures.
- No idempotency keys are used for sale payments or staff provisioning.

## 11. Poultry Business Logic Assessment

### Daily records

The database enforces:

- Mortality and culls non-negative.
- Feed given and leftovers non-negative.
- Leftover feed cannot exceed feed given.
- Temperature minimum cannot exceed maximum.
- Record date cannot precede batch placement.
- Losses plus sales cannot exceed chicks received.

Feed consumed is calculated as `max(feed_given - feed_left, 0)` in the performance and correction code. This is consistent with the documented rule.

### Batch management

Batch codes are validated only to contain allowed alphanumeric/hyphen segments and include the batch type code. The database enforces uniqueness `(farm_id, batch_code)`, but it does not enforce the full placement month/sequence naming formula described in the README. The `batch-code.ts` helper appears to implement generation separately, but creation still accepts user-provided codes.

Batch closure is owner/manager-gated and validates that the close date is not before the latest activity date.

### FCR

`batch_performance` correctly distinguishes:

- Running batch: sold live weight plus estimated remaining live weight from the latest weight sample.
- Closed batch: sold live weight only.
- FCR is null when output weight is unavailable or zero.

One limitation is that remaining birds must be based on a weight sample for running FCR; the view deliberately nulls FCR when no weight sample exists.

## 12. Financial Accuracy and Reconciliation Assessment

Positive financial controls:

- Sale amount is generated from birds or weight and price.
- Initial payment is recorded through `sale_payments`.
- Subsequent payments are append-only.
- Payment cashbook entries are automatically linked and immutable.
- Legacy paid amounts are migrated to payment history.
- Legacy `paid_kes` is constrained to zero after migration.
- Payment validation prevents overpayment.
- Corrections are append-only and adjust revenue and paid totals without rewriting the original.
- The revenue helper uses integer cents to reduce floating-point rounding issues.
- Sales and adjustment rows are summarized with the same cents-based logic.

Potential financial defects:

- Payment creation and initial payment do not expose an idempotency key. A retry or replay could create duplicate payment history and a duplicate cashbook row unless the caller retries the exact same request and the database somehow blocks it (it does not).
- The migration creates a legacy sale payment for each existing sale paid amount but does not create its historical cashbook entry, as intentionally documented. This must remain a manual migration review item because no live reconciliation data was available.
- The batch performance view uses payment totals and sale corrections in aggregate. Independent reconciliation against live sales and cash entries was not possible.
- The farm dashboard calculates feed stock as deliveries minus daily consumption minus correction feed delta. It does not include separate feed inventory receipts/consumption from stock movements, which may make the metric inconsistent when feed is managed through inventory.
- There is no periodic reconciliation job or signed/closed accounting period.

## 13. Frontend and UX Assessment

The main app is a large client component in `src/components/flockledger-app.tsx` with tabs, forms and API requests.

Positive observations:

- Loading and error states are present for major operations.
- Empty states and role-aware UI are used in places.
- The active farm is restored from local storage.
- Revenue filters and summaries are connected to `/api/sales`.
- Permission-sensitive UI such as team provisioning is present.

Risks and defects:

- The main file is highly large and contains many UI features; maintainability is low.
- Permission-aware UI depends on role strings and may be ahead of or behind RLS changes.
- Date, timezone and currency behavior should be tested in a browser at Nairobi DST boundaries (Kenya does not observe DST, but browser timezone handling still matters).
- No automated browser or component tests are present.
- Accessibility was not verified; the large form and table surfaces require a manual audit for labels, keyboard navigation and dialog behavior.
- Mobile responsiveness requires visual verification, not just static review.
- Local selected-farm state could become stale after membership removal.
- The staff setup screen asks for a temporary password; it should also make one-time/setup status and expired-link behavior explicit.

## 14. Performance and Scalability Assessment

### Strengths

- Key operational indexes exist for batch-date and farm-date queries.
- Dashboard calculations are implemented as SQL views.
- Batch and list queries filter by farm.
- The frontend batches independent dashboard data requests into `Promise.all`.

### Scalability concerns

- Most list routes return all matching rows without pagination.
- Revenue, corrections and dashboard endpoints can grow without limits.
- Views aggregate all rows for a farm or batch whenever queried.
- No materialized dashboard cache or refresh schedule is visible.
- No database query plans or live Supabase telemetry were reviewed.
- The main React component performs substantial state and rendering work in one component.
- Invitation and setup operations are multiple round trips and do not use a queued job.

For hundreds or thousands of farms, the main risk is data growth, not authorization isolation. Date indexes help, but sales, cash entries, daily records and stock movements need pagination and maintained aggregate/index strategies.

## 15. Testing and Code Quality Assessment

### Executed checks

| Check | Result |
|---|---|
| `npm test` | Passed: 6 test files, 20 tests |
| `npm run lint` | Passed |
| `npm run build` | Passed; 44 static/dynamic routes collected and TypeScript completed |

The tests cover:

- Signup validation.
- Batch-code validation.
- Daily-record validation.
- Editable-field handling.
- Corrections.
- Revenue validation and totals.

Missing test coverage:

- Live Supabase authentication and cookie session behavior.
- RLS cross-farm read/write tests.
- Role matrix tests for owner, manager, attendant, accountant and veterinarian.
- Staff provisioning, setup expiry, token reuse and password replacement.
- Last-owner removal/demotion.
- Batch closure and correction triggers.
- Sale/payment duplicate prevention and replay.
- Cashbook reconciliation.
- Inventory negative-stock races.
- Concurrent daily-record updates and sale payments.
- API integration tests for every route.
- Browser and accessibility tests.
- Migration tests against a fresh database and migrated sample database.

## 16. Deployment and Production Readiness

### Environment

Server-side variables are used for the service role. The server client uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, while the admin client uses `SUPABASE_SERVICE_ROLE_KEY`.

The service-role key is correctly kept out of the Supabase server client and, in source, is read only in `src/lib/supabase/admin.ts`. However, `.env.example` contains a service-role-looking secret and must be scrubbed/rotated.

### Hosting

No deployment workflow, Dockerfile, Vercel configuration or production logging configuration was found. The Next.js build and route compilation are compatible with the framework, but the hosting platform and database/network settings are not verified.

### Remaining deployment work

- Apply and verify all migrations in filename order against a non-production Supabase project.
- Verify all migration-derived RLS policies and grants in the deployed project.
- Configure HTTPS and the production app URL.
- Configure Supabase email confirmation and email delivery.
- Set cookie/session lifetime and refresh behavior.
- Configure backup, point-in-time recovery and restore testing.
- Configure application and database monitoring.
- Configure error tracking and structured logs.
- Configure rate limiting or a WAF.
- Verify database connection/transaction limits.
- Remove or rotate all credential values in `.env.example`.
- Establish a migration deployment and rollback procedure.

## 17. Security Vulnerability Register

### FL-SEC-001 - CRITICAL - Committed/Distributed Service-Role Credential

**Description:** `.env.example` contains a value that appears to be a real Supabase secret service-role key.  
**Evidence:** `.env.example:3` defines `SUPABASE_SERVICE_ROLE_KEY=...`. It is an example file in the workspace, while environment files are ignored by `.gitignore`.  
**Affected component:** Secrets/configuration.  
**Potential exploitation:** A live key would allow complete server/API bypass of RLS in the project.  
**Business impact:** Full database compromise, unauthorized financial changes and account access.  
**Remediation:** Revoke/rotate the key in Supabase immediately, replace with placeholders, store only in deployment-secret management, and audit repository history and file-sharing locations.  
**Verification:** Confirm the old key is inactive in Supabase and no secret value is present in source, logs or report artifacts.

### FL-SEC-002 - HIGH - Force-Password-Change Is Not Enforced by API Authorization

**Description:** Provisioned staff are assigned memberships immediately and ordinary API routes do not check `force_password_change`.  
**Evidence:** `202611210006_farm_invitations.sql` membership insertion occurs during staff creation in `src/app/api/farms/[farmId]/invitations/route.ts`; the user is inserted into `farm_memberships` before password setup.  
**Potential exploitation:** Anyone obtaining the temporary password can sign in and call API routes with the staff role before changing it.  
**Impact:** Unauthorized farm operations during the setup period.  
**Remediation:** Do not insert active membership until password setup succeeds and invitation is accepted, or reject every authenticated API/RPC operation with `app_metadata.force_password_change === true` via middleware and RLS/token claims. Add an expired setup deadline check.  
**Verification:** Attempt sign-in with a provisioned temporary password and call POST/PATCH routes for every role before setup; every mutation must be denied.

### FL-SEC-003 - HIGH - Staff Invitation and Setup State is Not Atomically Protected

**Description:** Account creation, membership insertion and invitation row creation are separate operations. Setup verification does not atomically consume the token or mark acceptance.  
**Evidence:** `src/app/api/farms/[farmId]/invitations/route.ts:68-132`; `src/app/api/staff/setup/verify/route.ts`; `src/app/api/staff/setup/password/route.ts:36-54`.  
**Potential exploitation:** Partial failures can leave orphan users or memberships. Token verification can occur repeatedly until password update clears it. Concurrent password changes can leave metadata and invitation status inconsistent.  
**Impact:** Unauthorized or duplicate setup, stale invitations and access mismatch.  
**Remediation:** Implement one database RPC transaction or Supabase Edge Function for account/membership/invitation provisioning and setup completion. Store status, expiry and used timestamp; consume token atomically and bind it to user ID/email.  
**Verification:** Force failures at each step and run concurrent setup requests; ensure no partial membership or reusable token remains.

### FL-SEC-004 - MEDIUM - No API Rate Limiting or Abuse Control

**Description:** No request throttling is visible on authentication, invitations or payment endpoints.  
**Evidence:** Sign-in, sign-up, staff verification and payment route handlers contain no per-IP/user rate-limit mechanism.  
**Potential exploitation:** Password guessing, setup-token guessing, invitation spam and repeated payment requests.  
**Impact:** Account compromise and operational abuse.  
**Remediation:** Use Supabase Auth rate limits plus application/WAF limits and route-level abuse counters or an edge rate limiter.  
**Verification:** Execute bounded load tests and confirm 429 responses after threshold without affecting normal users.

### FL-SEC-005 - MEDIUM - Setup and Account Enumeration Responses

**Description:** Staff provisioning reveals whether an email belongs to an existing user.  
**Evidence:** `src/app/api/farms/[farmId]/invitations/route.ts` maps Supabase `status === 422` to `A user with this email already exists.`  
**Potential exploitation:** Enumerate registered users and test mailbox ownership.  
**Impact:** Privacy and targeted phishing risk.  
**Remediation:** Use generic provisioning responses and add abuse controls. Document whether joining an existing account is allowed.  
**Verification:** Compare responses for existing and missing emails.

### FL-SEC-006 - MEDIUM - Invitation Acceptance Lacks Expiry Enforcement

**Description:** `accept_farm_invitations()` accepts every pending invitation matching the account email without verifying `setup_expires_at` or setup completion.  
**Evidence:** `202611210006_farm_invitations.sql:47-76`.  
**Potential exploitation:** An expired or stale pending invitation can update its status/membership.  
**Impact:** Unauthorized role persistence after invitation should have expired.  
**Remediation:** Include expiry and setup status in the RPC, and revoke/clean expired invitations. Ensure acceptance occurs only after password setup.  
**Verification:** Call the RPC with an expired and unsetup invitation and confirm no membership/accepted status changes.

### FL-SEC-007 - MEDIUM - No Replay or Idempotency Protection for Financial Mutations

**Description:** Payment and sale mutation routes accept repeat requests without an idempotency key or one-time client nonce.  
**Evidence:** `/api/sales/[saleId]/payments` inserts rows directly; `/api/sales` calls `create_sale` directly. Database constraints prevent overpayment and negative values, but do not prevent duplicate legitimate repeat submissions.  
**Potential exploitation:** Network retry or duplicated form submission creates duplicate payment history and sale-payment cash entries.  
**Impact:** False cashbook receipts and revenue reconciliation discrepancies.  
**Remediation:** Add idempotency keys persisted with sales/payments, disable duplicate submission client-side, and enforce unique keys in PostgreSQL.  
**Verification:** Submit identical requests twice concurrently and expect only one payment/sale.

### FL-SEC-008 - MEDIUM - Logging Exposes Internal Error Details to Operators Only, Not Sufficient Observability

**Description:** Routes log only database error codes/status values and generic unexpected errors. There is no structured correlation ID or centralized audit.  
**Evidence:** Repeated `console.error(...)` calls in API routes.  
**Potential exploitation:** Operational failures are difficult to detect or correlate.  
**Impact:** Security incidents and financial errors may remain unnoticed.  
**Remediation:** Add structured logs, request IDs, actor/farm context, redaction and alerting. Never log credentials or full request bodies.  
**Verification:** Trigger a controlled API error and confirm structured, correlated, redacted telemetry.

### FL-SEC-009 - LOW - CSRF/Origin Controls Are Not Explicit

**Description:** State-changing API handlers do not explicitly validate Origin or use a CSRF token.  
**Evidence:** Route handlers only validate JSON and Supabase session cookies. No Origin/Referer or CSRF middleware is present.  
**Potential exploitation:** Cross-site browser scenarios must be assessed against Supabase cookie configuration and SameSite behavior. It is not confirmed exploitable.  
**Impact:** Potential unauthorized state change if cookie policy permits it.  
**Remediation:** Adopt explicit origin checks or a CSRF mechanism for cookie-authenticated mutations, and verify SameSite/Secure/CORS settings.  
**Verification:** Cross-origin browser test with credentialed POST requests.

### FL-SEC-010 - INFORMATIONAL - Limited Security Headers and CSP

**Description:** No application security headers or Content-Security-Policy configuration is visible in `next.config.ts`.  
**Evidence:** `next.config.ts` contains development origin, cache and Turbopack settings only.  
**Potential exploitation:** This increases impact of XSS or clickjacking, if a separate XSS vulnerability existed.  
**Impact:** Reduced browser-side defense in depth.  
**Remediation:** Configure CSP, frame-ancestors, X-Content-Type-Options and referrer policy at the hosting/Next.js edge.  
**Verification:** Inspect production response headers and run browser security scans.

## 18. Functional Bugs and Logic Defects

### FL-BUG-001 - HIGH - Staff Can Operate Before Password Replacement

The metadata flag is not enforced server-side. A provisioned account is created and membership assigned before setup. It is only the setup UI and password endpoint that check or set the flag. See FL-SEC-002.

### FL-BUG-002 - HIGH - Existing Farm Membership Is Created Before Invitation Acceptance

The provisioning route inserts `farm_memberships` immediately, and the invitation RPC is not required for access. The setup flow should not grant an active role before setup is complete.

### FL-BUG-003 - MEDIUM - Invitation RPC Accepts Expired Pending Invitations

`accept_farm_invitations()` does not examine `setup_expires_at`. Expired invitations can be accepted through `/api/invitations/accept`.

### FL-BUG-004 - MEDIUM - Batch Creation Names Are Not Fully Server-Generated

The API accepts a batch code and only verifies that it contains the BR/KJ segment. The README requires a farm-name initials, placement month and sequence formula. The frontend helper can generate the code, but it does not enforce a global server-side sequence or reuse protection. The database provides uniqueness rather than sequence.

### FL-BUG-005 - MEDIUM - Dashboard Feed Stock Reconciliation Is Incomplete

`farm_dashboard` subtracts only daily-record feed consumption and correction deltas from feed deliveries. Separate inventory `stock_movements` are not included in this feed-stock formula.

### FL-BUG-006 - MEDIUM - Sale Payment Retry Is Not Idempotent

The database append-only constraint prevents mutation but not duplicate inserts.

### FL-BUG-007 - MEDIUM - No Live RLS or Migration State Verification

The source contains RLS declarations, but no live database test confirms that every migration was applied or that no conflicting policies exist.

### FL-BUG-008 - LOW - Batch/House/Asset Edits and Deletes Depend on UI or RLS

Generic edits are strictly field allowlisted, but the UI and route do not expose all database constraints in each form. Database constraints provide final enforcement.

### FL-BUG-009 - LOW - No Server-Side Pagination

Large record collections can increase response size and database load.

## 19. Missing Features and Incomplete Implementations

Confirmed missing or incomplete areas:

- Live integration and RLS test suite.
- Request pagination and row-limit controls.
- API or edge rate limiting.
- Payment/sale idempotency keys.
- Atomic staff provisioning/setup transaction.
- Server-enforced forced password change.
- Storage bucket/policy implementation or verification.
- Monitoring, alerting and error-tracking integration.
- Backup/restore procedure.
- Migration deployment/rollback automation.
- Security headers/CSP.
- Concurrency/load tests.
- Browser, accessibility and responsive visual tests.
- Periodic financial reconciliation reporting.
- Formal accounting closing/period-lock feature.
- A single server-authoritative batch-code sequence generator.

## 20. Technical Debt

- `src/components/flockledger-app.tsx` is a monolithic client component.
- Several route implementations duplicate authentication and error handling instead of using middleware or route helpers.
- Migration 001 creates policies dynamically and later migrations modify the same tables/functions. Review and migration squashing may be useful only after a stable baseline is verified.
- Most API lists have no cursor/offset pagination.
- Console logging is inconsistent and not correlated.
- Test suite has no database or browser coverage.
- The README is detailed, but database live state and deployment state are not documented.
- Legal pages contain draft copy, as noted in `README.md`.

## 21. Prioritized Remediation Roadmap

### Phase 1: Critical Security and Data Integrity

1. Rotate the Supabase service-role key and scrub `.env.example`.
2. Audit all secret exposure locations and git history.
3. Block API operations and RLS-sensitive RPC use until forced password changes complete.
4. Make staff provisioning and setup transactional and atomic.
5. Bind setup tokens to user ID/email and consume them once.
6. Enforce setup expiry in acceptance and setup verification.
7. Add integration tests for RLS, role matrix and cross-farm access.
8. Add live database migration verification and reconciliation.

### Phase 2: Functional Correctness

1. Add sale/payment idempotency and replay protection.
2. Improve batch-code generation and server-side sequence uniqueness.
3. Add financial reconciliation tests and reporting.
4. Add correction and cashbook integration tests.
5. Add inventory and feed-stock reconciliation.
6. Add API integration tests for all routes.
7. Fix stale-farm and forced-password UX behavior.

### Phase 3: Performance and Scalability

1. Add pagination to every list endpoint.
2. Add query limits and cursor-based pagination for large ledgers.
3. Add indexes based on Supabase query plans.
4. Consider materialized or scheduled dashboard aggregates.
5. Split the monolithic farm component into feature components.
6. Add load/concurrency tests.

### Phase 4: Production Deployment

1. Configure secure production environment secrets.
2. Configure auth, email, cookie, CSP and security headers.
3. Add WAF/rate limiting and abuse monitoring.
4. Configure backups, restore testing and migration automation.
5. Configure structured logging, alerting and error tracking.
6. Review legal, privacy and terms content before launch.

### Phase 5: Future Enhancements

1. Accounting-period closure and signed reconciliations.
2. File storage for compliance documents.
3. Scheduled dashboards and notification jobs.
4. Mobile/PWA capability.
5. Multi-currency design is future work; current implementation is KES-only by schema.
6. Advanced reporting and role-scoped exports.

## 22. Final Production Readiness Verdict

### A. The 10 most important problems discovered

1. Potential real service-role credential in `.env.example`.
2. Staff membership is active before password setup is complete.
3. Server authorization does not enforce `force_password_change`.
4. Staff provisioning/setup operations are not atomic or fully idempotent.
5. Setup and invitation acceptance do not fully enforce expiry/consumption.
6. No live RLS or database migration verification was performed.
7. No rate limiting or replay protection for authentication and financial mutations.
8. No integration, RLS, concurrency or browser tests.
9. No pagination for potentially large farm/ledger datasets.
10. Deployment monitoring, backup and migration automation are not visible.

### B. The 10 most important improvements recommended

1. Rotate secrets and adopt deployment-secret management.
2. Implement atomic staff provisioning and setup.
3. Add server middleware/RLS enforcement for setup-required accounts.
4. Add RLS integration tests and cross-farm negative tests.
5. Add payment/sale idempotency keys.
6. Add auth and API rate limits.
7. Paginate all record lists and dashboards.
8. Add migration deploy/review automation.
9. Add structured logs, alerts and backups.
10. Add browser, mobile and accessibility testing.

### C. Production readiness score

**Overall score: 68 / 100**

The score is based on:

- Architecture and RLS design: 20 / 25
- Authentication and staff provisioning: 8 / 15
- Financial integrity: 12 / 15
- Data isolation and database constraints: 10 / 15
- Testing and quality: 8 / 10
- Deployment and operations: 5 / 10
- UX and scalability: 5 / 10

The codebase has strong database and financial design foundations, and all executed local checks pass. The score is reduced by the secret concern, provisional staff access, missing live RLS verification, no integration/concurrency tests and incomplete operations/deployment controls.

## 23. Files, Migrations and Database Objects Requiring Manual Review

### Files

- `.env.example`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/admin.ts`
- `src/app/api/farms/[farmId]/invitations/route.ts`
- `src/app/api/staff/setup/verify/route.ts`
- `src/app/api/staff/setup/password/route.ts`
- `src/app/api/invitations/accept/route.ts`
- `src/app/api/sales/route.ts`
- `src/app/api/sales/[saleId]/payments/route.ts`
- `src/app/api/corrections/route.ts`
- `src/app/api/dashboard/route.ts`
- `src/lib/revenue/sales.ts`
- `src/lib/api/editable-records.ts`
- `src/components/flockledger-app.tsx`
- `next.config.ts`
- `package.json`
- `README.md`

### Migrations

- `202611210001_initial_schema.sql`
- `202611210002_financial_corrections_and_dashboard.sql`
- `202611210003_guide_operations_records.sql`
- `202611210004_farm_dashboard_summary.sql`
- `202611210005_revenue_payments.sql`
- `202611210006_farm_invitations.sql`

### Database objects

- `public.create_farm`
- `public.is_farm_member`
- `public.has_farm_role`
- `public.accept_farm_invitations`
- `public.create_sale`
- `public.validate_sale_payment`
- `public.create_sale_payment_cash_entry`
- `public.validate_correction`
- `public.validate_stock_movement`
- `public.prevent_closed_batch_mutation`
- `public.prevent_closed_batch_insert`
- `public.protect_last_farm_owner`
- `public.batch_performance`
- `public.farm_dashboard`
- `public.inventory_balances`
- `public.farm_invitations`
- `public.sale_payments`
- `public.audit_events`
- All RLS policies on farm, membership, operational and financial tables

---

# Phase 1 Remediation Addendum

**Remediation date:** 22 November 2026  
**Scope:** Confirmed critical/high code gaps and applicable security headers, origin controls, idempotency and staff lifecycle protections.  
**Live database note:** No migration was applied to any Supabase project. No live RLS/API integration environment was available.

## A. Executive summary

### What was inspected

The existing source, migrations, API routes, environment files, Git status and Next.js configuration were re-inspected before changes. Existing dirty files were preserved. The work included the forced-password flow, staff invitation lifecycle, sales and payment mutations, auth setup routes, origin validation and response headers.

### What was changed

- Added an API Proxy guard that requires a real Supabase session for protected `/api/*` paths and blocks `force_password_change` accounts.
- Added same-origin validation for mutating browser requests and request-ID response headers.
- Added database-backed idempotency functions for sales and sale payments.
- Added a migration for staff setup token consumption, expiry-aware invitation acceptance and persistent authentication attempt counters.
- Added compensation cleanup for failed staff invitation persistence.
- Generalized staff provisioning/account-enumeration responses.
- Replaced example/local privileged environment values with placeholders.
- Added CSP and common security headers in `next.config.ts`.
- Added focused unit tests for origin validation, protected API classification, idempotency keys and payload/attempt hashing.

### Overall security improvement

The application now has central server-side account setup enforcement, explicit origin rejection, database idempotency primitives, setup-token consumption and security-header baseline code. These improvements are not complete production controls until migration 007 is deployed and a live Supabase test project is used.

### Remaining risks

Live RLS and migrations remain unverified. Distributed rate limiting depends on migration deployment and Supabase RPC availability. Migration deployment, secret rotation, backup/recovery, monitoring and live cross-farm testing require manual action.

## B. Finding-by-finding status

| Finding | Status | Evidence | Files and database objects | Tests and limits |
|---|---|---|---|---|
| FL-SEC-001 | **REQUIRES MANUAL ACTION** | `.env.example` and `.env.local` contained service-role-looking values. Git showed neither environment file is tracked. | `.env.example`, `.env.local`, `src/lib/supabase/admin.ts` | Replaced with placeholders and kept `SUPABASE_SERVICE_ROLE_KEY` server-only. Rotation and dashboard verification must be done manually. |
| FL-SEC-002 | **PARTIALLY FIXED** | Normal protected API paths now inspect the trusted Supabase user metadata in `src/proxy.ts`; setup and auth endpoints remain allowed. | `src/proxy.ts`, `src/app/api/staff/setup/password/route.ts` | Build and unit tests pass. Live token/JWT and direct-Supabase behavior must be tested with a setup account. |
| FL-SEC-003 | **PARTIALLY FIXED** | Staff provisioning now compensates membership and Auth user creation on invitation-persistence failure. Setup token consumption is database-backed. | `src/app/api/farms/[farmId]/invitations/route.ts`, `src/app/api/staff/setup/verify/route.ts`, `public.consume_staff_setup_token`, migration 007 | It is not one Supabase transaction. Live concurrent/failed provisioning tests are blocked without Supabase credentials. |
| FL-SEC-004 | **PARTIALLY FIXED** | Persistent auth attempt tables/functions were added for sign-in and staff setup. | migration 007, `src/app/api/auth/sign-in/route.ts`, `src/app/api/staff/setup/verify/route.ts`, `public.check_auth_attempt`, `public.record_auth_attempt` | Migration deployment is required before these controls become active. A distributed edge/WAF limiter is still a deployment recommendation. |
| FL-SEC-005 | **FIXED** | Staff provisioning now returns a generic inability message for existing-email/auth creation failures. Sign-in remains generic. | `src/app/api/farms/[farmId]/invitations/route.ts`, `src/app/api/auth/sign-in/route.ts` | No live response comparison was performed. |
| FL-SEC-006 | **PARTIALLY FIXED** | Invitation verification now requires `pending`, and the database consume function requires pending status, expiry and matching account email. Acceptance now requires accepted status. | `src/app/api/staff/setup/verify/route.ts`, `src/app/api/staff/setup/password/route.ts`, `public.consume_staff_setup_token`, `public.accept_farm_invitations` | Live token reuse/concurrency testing is blocked until migration deployment and a test Supabase project are available. |
| FL-SEC-007 | **PARTIALLY FIXED** | Sales and sale payments now require an idempotency header and call database-backed idempotent RPC functions. Repeated keys verify payload hashes and return original responses. | `src/app/api/sales/route.ts`, `src/app/api/sales/[saleId]/payments/route.ts`, `public.create_sale_idempotent`, `public.create_sale_payment_idempotent`, `public.flockledger_idempotency` | Unit and build checks pass. Concurrent and rollback behavior require deployed migration and live PostgreSQL tests. |
| FL-SEC-008 | **PARTIALLY FIXED** | API responses and proxy include `x-request-id`; request IDs are generated or accepted. Logging still uses existing route console logging. | `src/proxy.ts`, `src/lib/proxy-security.ts` | No centralized structured logging backend was added. |
| FL-SEC-009 | **FIXED** | Mutating API requests with mismatched `Origin` or cross-site `Sec-Fetch-Site` are rejected by Proxy. | `src/proxy.ts`, `src/lib/proxy-security.ts`, `tests/security.test.ts` | Same-origin unit tests pass. Live browser and server-to-server origin behavior still require validation. |
| FL-SEC-010 | **FIXED** | Next.js response headers now include CSP, HSTS, nosniff, frame denial, referrer policy and permissions policy. | `next.config.ts` | Production build passes. Browser CSP behavior should be verified in the deployed origin. |

## C. Files changed

### Modified

- `.env.example` — safe Supabase placeholders.
- `.env.local` — privileged-looking values removed and replaced with placeholders.
- `next.config.ts` — CSP and security headers.
- `src/proxy.ts` — session setup-state guard, origin rejection and request IDs.
- `src/lib/proxy-security.ts` — pure proxy request-security helpers.
- `src/lib/security.ts` — payload, attempt and idempotency helpers.
- `src/components/flockledger-app.tsx` — idempotency keys for mutating browser requests.
- `src/app/api/auth/sign-in/route.ts` — persistent attempt check and failure recording.
- `src/app/api/staff/setup/verify/route.ts` — setup attempt limits and database token consumption.
- `src/app/api/staff/setup/password/route.ts` — accepted invitation finalization and RPC acceptance.
- `src/app/api/farms/[farmId]/invitations/route.ts` — generic enumeration response and provisioning compensation.
- `src/app/api/sales/route.ts` — idempotency header and RPC call.
- `src/app/api/sales/[saleId]/payments/route.ts` — idempotency header and RPC call.
- `tests/security.test.ts` — focused security helper tests.

### Created

- `src/proxy.ts`
- `src/lib/proxy-security.ts`
- `src/lib/security.ts`
- `supabase/migrations/202611220001_phase1_security_integrity.sql`
- `tests/security.test.ts`

## D. Database changes

The following migration was created but not deployed:

- `supabase/migrations/202611220001_phase1_security_integrity.sql`

### New objects

- `public.flockledger_idempotency`
- `public.create_sale_idempotent(...)`
- `public.create_sale_payment_idempotent(...)`
- `public.consume_staff_setup_token(text)`
- `public.auth_attempt_limits`
- `public.check_auth_attempt(text, text, integer, integer)`
- `public.record_auth_attempt(text, text, integer)`

### Modified objects

- `public.accept_farm_invitations()` — now accepts setup-completed invitations instead of accepting pending invitations.

No live table, policy or function was changed by this remediation.

### Manual deployment steps

1. Back up and inspect the target Supabase project.
2. Apply migration 007 in filename order to a non-production test project.
3. Verify every function signature and RLS grant.
4. Test staff setup, duplicate accepts and concurrent token use.
5. Test duplicate sales/payments and payment/cashbook relationships.
6. Apply to production only after review and explicit approval.

## E. Test results

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm test` | Passed: 7 files, 25 tests |
| `npm run build` | Passed: 44 routes generated; Proxy compiled |
| Live Supabase RLS integration | Not run; credentials/test project unavailable |
| Live migration deployment | Not run; no live database approval |
| Live staff setup concurrency | Not run |
| Live financial concurrency | Not run |
| Browser CSP verification | Not run |

No destructive database operation was executed.

## F. Manual actions required

1. Revoke/rotate the confirmed or suspected live Supabase service-role credential through the Supabase dashboard. The old key must be considered exposed until revoked.
2. Replace placeholder environment variables with approved local/deployment secrets.
3. Never restore privileged values to `.env.example` or Git-tracked files.
4. Apply migration 007 to a test project and then production.
5. Configure a deployment-distributed rate limiter or WAF; migration attempt counters are a database-assisted interim control, not an edge/DDoS control.
6. Configure production `NEXT_PUBLIC_APP_URL` and HTTPS.
7. Verify Supabase Auth cookie and session settings.
8. Configure CSP exceptions only if browser validation identifies a required external resource.
9. Configure email delivery, backup/PITR, monitoring, error tracking and restore tests.

## G. Remaining production risks

- Live RLS policies and migration state were not executed against Supabase.
- Staff provisioning is compensation-safe but not a single database transaction because Supabase Auth account creation occurs outside SQL.
- Service-role and publishable/anon key values must be independently audited in secrets/history.
- Distributed edge rate limiting is still required for high-volume login abuse.
- Sale/payment idempotency requires migration deployment and concurrency testing.
- Cashbook reconciliation and existing historical financial data require independent review.
- Pagination and dashboard scalability remain unresolved.
- Browser CSP, mobile UX and accessibility require visual testing.

## H. Recommended next phase

1. Deploy migration 007 to an authorized isolated test project.
2. Add live RLS and role-matrix integration tests.
3. Test staff provisioning, setup reuse/expiry and concurrent acceptance.
4. Test concurrent duplicate sale/payment submissions and rollback behavior.
5. Add distributed edge/WAF rate limiting.
6. Add structured logging with request IDs and redaction.
7. Add pagination and query-plan-based performance indexes.

---

# Phase 2 Remediation Addendum

**Remediation date:** 22 November 2026  
**Scope:** Financial idempotency, authentication abuse controls and account/setup-sensitive routes.

## Phase 2 changes

### Financial replay prevention

- Sale creation now requires an `Idempotency-Key` header and calls `public.create_sale_idempotent`.
- Sale payment creation now requires an `Idempotency-Key` header and calls `public.create_sale_payment_idempotent`.
- Cash entry creation now requires an `Idempotency-Key` header and calls `public.create_cash_entry_idempotent`.
- Closed-batch correction creation now requires an `Idempotency-Key` header and calls `public.create_correction_idempotent`.
- Idempotency rows are scoped by farm, operation and key.
- Database functions verify the authenticated actor and payload hash.
- Sale and payment role checks are enforced inside the database functions.
- The browser API helper creates a key for mutating requests; sale and payment submissions also provide explicit keys.

### Abuse prevention

- Sign-in uses the persistent attempt RPC for account/IP or account-scope throttling.
- Sign-up uses the same RPC with a separate one-hour scope.
- Staff setup verification records failed temporary-password attempts.
- Staff password setup and invitation acceptance have bounded database-assisted attempt checks.
- Staff invitation creation has a bounded invitation-creation check.
- All sensitive attempt functions are `SECURITY DEFINER` and search-path hardened.

### Staff lifecycle correction

- The staff password route now accepts the setup token and consumes it through `consume_staff_setup_token`.
- Token consumption is restricted to the authenticated account email and pending, non-expired invitation.
- Successful password setup marks the invitation accepted before membership acceptance.

## Phase 2 database objects

Migration: `supabase/migrations/202611220002_phase2_financial_abuse.sql`

- Replaces/strengthens `public.create_sale_idempotent`
- Replaces/strengthens `public.create_sale_payment_idempotent`
- Adds `public.create_cash_entry_idempotent`
- Adds `public.create_correction_idempotent`
- Adds an idempotency creation-time index
- Adds actor ownership to idempotency records

Migrations 007 and 008 were syntax-validated and both were deployed to the authorized test database on 22 November 2026.

## Phase 2 finding status

| Finding | Status | Evidence |
|---|---|---|
| FL-SEC-007 | **PARTIALLY FIXED** | Sales, payments, cash entries and corrections have database idempotency primitives and payload hash checks. Live concurrent/rollback tests are required before it can be classified FIXED. |
| FL-SEC-004 | **PARTIALLY FIXED** | Authentication, setup and invitation routes use persistent database attempt counters. Deployment and edge/WAF limiting are still required for distributed abuse protection. |
| FL-SEC-003/006 | **PARTIALLY FIXED** | Setup token consumption is now server/database enforced and requires account binding and expiry. Full provisioning remains compensation-based rather than one Supabase Auth transaction. |
| FL-SEC-005 | **FIXED** | Existing account creation and sign-in paths use generic public responses. |

## Phase 2 test results

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm test` | Passed: 7 files, 26 tests |
| `npm run build` | Passed: 44 routes generated |
| Live PostgreSQL idempotency concurrency | Partially blocked; rolled-back repeated-key tests passed, concurrent setup was RLS-blocked |
| Live payment/cashbook rollback | Migration transaction and rolled-back SQL tests passed |
| Live invitation expiry/reuse | Not run |
| Distributed rate-limit performance | Not run |

## Phase 2 manual actions

1. Keep migrations 007 and 008 deployed only in the approved test database until production review is complete.
2. Verify migration SQL syntax and RPC signatures.
3. Run concurrent duplicate sales, payments, cash entries and corrections.
4. Verify same key/different payload rejection.
5. Verify failed RPC operations roll back both financial rows and idempotency rows.
6. Verify expired, reused and wrong-account setup tokens.
7. Add WAF or edge rate limiting for distributed login and setup abuse.
8. Apply migrations to production only after independent review and approval.

## Live database verification addendum

**Verification date:** 22 November 2026

The direct PostgreSQL test target was reached over its Supabase pooler. Migration syntax and database credentials were checked without printing or recording secrets.

### Deployment verification

- PostgreSQL 17.12 was reachable.
- Migrations `202611220001_phase1_security_integrity.sql` and `202611220002_phase2_financial_abuse.sql` passed rolled-back syntax validation.
- Both migrations were deployed in a single transaction.
- The idempotency and authentication-attempt tables are RLS-enabled.
- All Phase 1 and Phase 2 remediated functions were present after deployment.

### Live SQL integration results

- Cross-farm RLS isolation passed: an authenticated owner from Farm A saw zero rows in Farm B.
- Repeated sale idempotency passed: one sale remained and both calls returned the same sale ID.
- Repeated sale-payment idempotency passed: the repeat returned the original payment ID.
- Repeated cash-entry idempotency passed: one matching entry remained.
- Repeated correction idempotency passed: one correction remained.
- Same-key/different-payload payment validation passed: the second payload was rejected and no additional payment row remained.
- All temporary test users, farms, memberships and financial rows were removed.
- Final cleanup verification found zero temporary test users and zero temporary test farms.

### Incomplete live tests

- Concurrent duplicate-submission load testing was not completed; the temporary concurrent setup was rejected by the existing batch RLS insert policy.
- Staff setup expiry, reuse and wrong-account scenarios were not live-tested.
- No existing financial history was modified.

### Final verification status

- `npm run lint`: passed.
- `npm test`: passed, 7 test files and 26 tests.
- `npm run build`: passed before live database verification.
- Migration syntax validation: passed.
- Migration deployment: passed.
- Cross-farm and repeated-key SQL tests: passed.
- Temporary-row cleanup: passed.

# Phase 3 Performance Addendum

**Scope:** Bounded list responses, stable ordering, user-driven paging for the dashboard and ledgers, query indexes, and splitting large client features into on-demand components.

## Changes implemented

- Added shared bounded pagination parsing (default page size 50, maximum page size 100) and page metadata with stable ordering to the paginated collection APIs.
- Added dashboard status filtering, paged batch navigation, active-batch counts, and a compact latest-active-batches view. Batch, daily-record, revenue, and payment-history views now request bounded pages.
- Moved the batch, daily-record, and revenue views out of the main client component and into dynamically imported feature components. Shared request, formatting, icon, type, metric, and pagination helpers were extracted. The app shell and overview remain in the main component.
- Reworked revenue listing to use `get_revenue_ledger_page`, a database-side cursor-paging function that returns the current page and exact filtered summary together. It preserves correction, payment-status, search, and Nairobi-date adjustment behavior.
- Reworked batch-filtered cash-entry listing to use `get_batch_cash_entries_page`, which merges direct batch entries with sale-payment cash entries in the database and pages the stable, combined order. This removes the prior unbounded ID and cash-entry reads.
- Added migrations `202611220003_phase3_query_indexes.sql`, `202611220004_phase3_revenue_paging.sql`, and `202611220005_phase3_cash_entry_paging.sql`. They add query-aligned indexes and the revenue and batch-cash paging functions.
- Added repeatable transactional SQL checks for batch-cash paging and a synthetic 10,000-row benchmark under `tests/`.

## Deployment and verification

- Phase 3 migrations 003–005 have been applied to the configured, previously approved Supabase test database. No migration was applied to production.
- The batch-cash SQL integration check passed: combined direct/payment entries were correctly ordered and split across pages, and rows for another batch were excluded. All fixtures were rolled back.
- The synthetic 10,000-row check passed: page 100 returned 100 rows, page 101 returned none, and both reported the exact total. The measured database function call took about 23.4 ms with 10,117 shared-buffer hits and temporary I/O (339 pages read, 340 written). This is one synthetic test-database measurement, not an end-to-end or production-scale performance claim.
- Existing transactional revenue RPC checks passed, covering correction adjustments, filtered summary totals, cursor traversal, and no repeated rows.
- `npm test`: passed, 8 files and 28 tests.
- `npm run lint`: passed without warnings.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; 44 routes generated.
- `git diff --check`: passed.

## Remaining scalability work

This completes the Phase 3 implementation tranche, but it is not a production load/performance certification:

- The dashboard still reads aggregate views; paging its returned batch list does not eliminate the underlying view aggregation cost.
- Revenue paging bounds returned rows and application transfer, but exact summaries and payment-status filters still process the matching history on each request.
- The cash-entry RPC computes an exact total and merges matching entries on each request. The synthetic benchmark also showed temporary I/O; cursor pagination or query-plan changes may be warranted after representative measurement.
- Offset-based pages can become expensive at deep page numbers. Revenue uses a cursor, but other lists remain offset-paginated.
- No production-sized dataset, concurrent request test, or production workload benchmark was run. Index presence and the synthetic 10,000-row result do not establish production performance.
- The feature views are code-split for on-demand loading, but bundle-size impact was not measured, and the main app shell is still a large component.
