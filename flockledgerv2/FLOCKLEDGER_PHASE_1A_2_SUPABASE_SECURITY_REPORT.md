# FlockLedger Phase 1A.2 — Supabase Auth and API Security Verification

**Status:** Partial verification completed; overall tenant isolation remains **UNVERIFIED**.  
**Scope:** Real Supabase Auth sessions, selected PostgREST operations, selected application API routes, and one RPC, against a user-designated disposable hosted Supabase project.  
**Production impact:** No production database, production data, application authorization code, or RLS policy was intentionally changed.

## 1. Executive summary

Six synthetic identities were created: two farm owners and one manager, accountant, attendant, and veterinarian for Farm A. They obtained real Supabase password-grant sessions and application cookie sessions. Requests were made with the individual identities through PostgREST and an isolated local Next.js application.

In the scenarios that actually ran:

- Farm A's owner did not retrieve Farm B batch or daily-record data through tested PostgREST and application read routes.
- Cross-farm inserts were rejected or produced no persisted row.
- Updates and deletes targeting a Farm B daily record changed or removed no row, including requests that supplied either farm ID.
- A cross-farm batch-quota RPC call was rejected and created no batch.
- Tested manager, accountant, attendant, and veterinarian permissions matched the tested outcomes recorded below. Denied writes were checked against database state.
- Sign-out returned HTTP 200; replay of the old application cookie returned HTTP 401.

The original run recorded **49 assertions: 47 passed and 2 failed**. The two failed assertions expected HTTP 403 for denied accountant daily-record and veterinarian cash-entry writes; the actual response was HTTP 409, and database checks found neither row persisted. Source routes map PostgreSQL `P0001` to HTTP 409. The test runner's expected-status checks were updated to accept 403 or 409. The runner was syntax-checked, but the updated version was **not rerun**.

Cleanup did not complete. Farm deletion is blocked by append-only subscription events and their `ON DELETE RESTRICT` relationship. Attempts to remove the associated Auth users also failed because references remained. A subsequent cleanup connection attempt failed with `ECONNRESET`. Treat the hosted test project as contaminated with synthetic test data and retire it through the Supabase Dashboard; do not disable triggers or policies to force cleanup.

These observations support the tested scenarios only. They are not evidence that every tenant-owned table, route, RPC, role, or Supabase behavior is secure.

## 2. Test environment

| Item | Observed configuration |
|---|---|
| Supabase target | User-designated disposable hosted project; its URL was required by the runner to use the `*.supabase.co` domain |
| Project identity | Not independently attested by the test harness; the disposable-project designation was supplied by the user |
| Supabase/PostgreSQL server version | Not obtained or recorded |
| Authentication | Real Supabase Auth Admin user creation and password-grant sessions |
| Application | Isolated copy of tracked source, served locally on port 3101 with Webpack |
| Local runtime | Windows; Node.js 26.13.0; Next.js 16.4.6 |
| Credentials | Loaded from `.env.local`; keys, passwords, and tokens were not printed or included in this report |
| Service-role use | Fixture setup and post-operation state verification only; attack requests used the relevant user's access token or application cookie |
| GitHub Actions | Not run |

The existing server on port 3000 was not used for security requests. The isolated Next.js server returned HTTP 401 for a protected API request without an authenticated session. Turbopack could not resolve the external `node_modules` junction in the temporary copy, so the isolated server was started with Webpack instead.

The test runner is [verify.mjs](../tests/security-phase1a-2/verify.mjs). It requires `--confirm-disposable-project`, refuses URLs outside `*.supabase.co`, and reads the required environment variables without logging their values. These guards do **not** prove that a hosted project is disposable or prevent a user from pointing the runner at the wrong Supabase project. Confirm the project in the Supabase Dashboard before running.

## 3. Application surface inspected

The preceding static security review inventoried 37 API route files and found no server actions under `src`. The application uses cookie-backed Supabase server sessions; API routes generally authenticate with `getUser()`, with farm and role authorization relying on RLS and database RPC checks. Static inspection is not equivalent to executing those routes.

### Routes exercised end-to-end

- `GET /api/farms` — anonymous request and stale-cookie replay.
- `POST /api/auth/sign-in`, `POST /api/auth/sign-out`.
- `POST /api/farms`, `GET /api/batches`, `POST /api/batches`, `POST /api/batches/{id}/close`.
- `GET /api/daily-records`, `POST /api/daily-records`.
- `PATCH` and `DELETE /api/records/daily-records/{id}`.
- `POST /api/sales`, `POST /api/cash-entries`, `POST /api/health-records`.
- `POST /api/farms/{farmId}/invitations` and `PATCH /api/farms/{farmId}/members`.

The corresponding route implementations include [farms/route.ts](../src/app/api/farms/route.ts), [batches/route.ts](../src/app/api/batches/route.ts), [daily-records/route.ts](../src/app/api/daily-records/route.ts), [daily-record mutation route](../src/app/api/records/%5Bresource%5D/%5BrecordId%5D/route.ts), [sales/route.ts](../src/app/api/sales/route.ts), [cash-entries/route.ts](../src/app/api/cash-entries/route.ts), [health-records/route.ts](../src/app/api/health-records/route.ts), [farm invitations route](../src/app/api/farms/%5BfarmId%5D/invitations/route.ts), and [farm members route](../src/app/api/farms/%5BfarmId%5D/members/route.ts).

### Direct PostgREST and RPC operations exercised

Direct authenticated PostgREST requests targeted `batches`, `daily_records`, and `farm_memberships`, plus the `create_batch_with_quota` RPC. Admin PostgREST calls were used to set up memberships and verify resulting database state. No direct SQL session using Supabase's authenticated database role was executed in this phase.

The RPC call exercised was `rpc/create_batch_with_quota`, implemented in the repository's migrations. The membership role change route invokes `update_farm_member_role`. Other privileged functions were inspected in the earlier static review but were not all invoked as real authenticated users in this run.

## 4. Identity and fixture setup

The runner created:

- User A: owner of Farm A.
- User B: owner of Farm B.
- User C: manager of Farm A.
- User D: accountant of Farm A.
- User E: attendant of Farm A.
- User F: veterinarian of Farm A.

All six identities authenticated through Supabase Auth and then through the application's cookie sign-in route. Synthetic batches were created for both farms; a daily record was created for Farm B. Additional operational rows were created only for role checks. Test-specific names, values, and identifiers were used; no production data was copied.

## 5. Executed results

| Scenario | Observed response/result | Database state checked | Assessment |
|---|---|---|---|
| Anonymous `GET /api/farms` | 401 | Not applicable | Rejected |
| Owner A reads Farm B batch in PostgREST | 200 with an empty result | Farm B fixture existed | No cross-farm row disclosed |
| Owner A reads Farm B batch and daily record through application API | 200 | Response did not contain Farm B fixture IDs | No cross-farm row disclosed |
| Owner A directly inserts a Farm B batch | 403 | No matching batch | Rejected |
| Owner A inserts a Farm A daily record referencing a Farm B batch | 400 | No matching cross-farm record | Rejected |
| Owner A inserts a Farm B batch through application API | 403 | No matching batch | Rejected |
| Owner A updates/deletes Farm B daily record via PostgREST, pairing Farm B record ID with either Farm A or Farm B `farm_id` | 200, zero affected rows | Original Farm B record remained unchanged | No mutation observed |
| Owner A updates/deletes Farm B daily record through application API with either farm ID | 404 | Original Farm B record remained unchanged | Not found/denied; no mutation observed |
| Owner A closes Farm B batch through application API | 404 | Farm B batch remained `running` | Not found/denied; no mutation observed |
| Owner A invokes cross-farm `create_batch_with_quota` | 403 | No matching batch | Rejected |
| Manager creates Farm A batch | 201 | Batch fixture was created | Allowed in tested case |
| Manager creates staff invitation | 403 | No invitation was created | Denied |
| Owner A creates invitation for Farm B | 403 | No invitation was created | Denied |
| Manager promotes self to owner | 403 | Membership role remained `manager` | Denied |
| Accountant creates Farm A sale and cash entry | 201 each | Both records existed in Farm A | Allowed in tested cases |
| Accountant creates daily record | 409 | No matching record | Denied; original harness incorrectly expected only 403 |
| Attendant creates daily record | 201 | Record existed in Farm A | Allowed in tested case |
| Attendant creates health record | 403 | No matching record | Denied |
| Veterinarian creates health record | 201 | Record existed in Farm A | Allowed in tested case |
| Veterinarian creates cash entry | 409 | No matching entry | Denied; original harness incorrectly expected only 403 |
| Owner changes accountant's Farm A role to manager | 200 | Membership role changed to `manager` | Allowed in tested case |
| Owner signs out; old application cookie is replayed | Sign-out 200; replay 401 | Protected API rejected replay | Rejected in observed run |

The HTTP 409 responses for role-denied writes are consistent with route code mapping PostgreSQL `P0001` to 409 in [daily-records/route.ts](../src/app/api/daily-records/route.ts) and [cash-entries/route.ts](../src/app/api/cash-entries/route.ts). Status codes alone are not treated as proof: the corresponding absence or unchanged state was also checked through an administrative PostgREST query.

The direct PostgREST UPDATE and DELETE calls returning HTTP 200 do not mean the operation succeeded; each response contained zero affected rows, and the fixture's original state was verified afterward.

## 6. Role authorization matrix

This is a matrix of **observed operations**, not a complete role-permission specification.

| Identity | Operation | Result | State verification |
|---|---|---|---|
| Owner | Change Farm A member role | Allowed (200) | New role persisted |
| Owner | Access Farm B data or mutate Farm B rows | Denied/no row | Reads empty; records unchanged |
| Manager | Create Farm A batch | Allowed (201) | Synthetic batch created |
| Manager | Invite staff or self-promote to owner | Denied (403) | No invitation; role remained manager |
| Accountant | Create Farm A sale/cash entry | Allowed (201) | Both rows persisted |
| Accountant | Create daily record | Denied (409) | No row persisted |
| Attendant | Create daily record | Allowed (201) | Row persisted |
| Attendant | Create health record | Denied (403) | No row persisted |
| Veterinarian | Create health record | Allowed (201) | Row persisted |
| Veterinarian | Create cash entry | Denied (409) | No row persisted |

## 7. Findings and severity

### Confirmed application vulnerabilities

None were confirmed in the executed scenarios. This is not a finding that the untested application is secure.

### Test-harness defects and limitations

1. **Incorrect expected status codes in the first run.** Two authorization assertions expected 403 while the application returned 409. The runner was updated to accept 403 or 409 and the denial is supported by database-state checks. That edited version has not been rerun.
2. **Session assertion tightened after the run.** The previous assertion accepted either 401 or 200, which could have allowed a stale-cookie replay to count as passing. It now requires 401. The observed replay was 401, but the tightened assertion has not been rerun.
3. **Cleanup is incomplete by design and the runner cannot report a clean exit while farms were created.** The runner attempts to remove mutable farm-scoped rows and non-owner memberships, but keeps farms and append-only subscription events. It sets `cleanupRequiresProjectRetirement` when any synthetic farm exists and exits nonzero. This is intentionally visible rather than presenting a contaminated project as cleaned.
4. **No complete security matrix.** Only selected tables and routes were exercised. Most cross-tenant table/operation combinations, owner/manager read and delete permissions, and privileged functions remain untested.

The subscription retention behavior is supported by [202611240001_subscription_foundation.sql](../supabase/migrations/202611240001_subscription_foundation.sql): `subscription_events.farm_id` references farms with `ON DELETE RESTRICT`, and the `subscription_events_immutable` trigger rejects update and delete operations.

## 8. Failed, skipped, and unexecuted tests

### Verified and passed

- 47 of the 49 original recorded assertions passed.
- All listed requests and resulting database checks in Section 5 were observed during the original run.
- Real Auth and application cookie sessions were obtained for all six synthetic identities.
- The stale-cookie replay returned 401 in the observed run.
- `node --check tests/security-phase1a-2/verify.mjs` passed after the final stale-cookie assertion tightening. This syntax check does not constitute a hosted security-suite rerun.

### Verified and failed

- Two original runner assertions failed because they expected status 403 rather than the observed 409. The underlying operations were denied, and the database-state checks confirmed no unauthorized rows.
- Cleanup failed to remove the synthetic farms/events and associated owner identities. The observed errors included farm deletion blocked by the append-only subscription history, event deletion rejected by its immutable trigger, and Auth user deletion blocked by remaining references.

### Not executed or not verified

- The corrected runner, including its 403-or-409 expectations and strict stale-cookie check, was not rerun.
- A follow-up cleanup attempt could not connect to the hosted project (`ECONNRESET`); no success is claimed for that attempt.
- No GitHub Actions execution was performed; there is no workflow run identifier.
- The hosted Supabase/PostgreSQL version was not captured.
- No real expired-session test was performed; only sign-out followed by replay of the prior cookie was observed.
- Valid owner invitation creation, invitation acceptance, employee provisioning/setup links, account suspension/deactivation, and staff password setup were not tested.
- Sale payments, cashbook corrections, inventory movements, stock adjustments, batch closure by authorized roles, and financial reconciliation were not tested.
- Cross-tenant writes were not exhaustively attempted on every tenant-owned table.
- Not every SECURITY DEFINER function, execution grant, owner, or search path was tested at runtime.
- The complete owner/manager/accountant/attendant/veterinarian operation matrix was not executed.

## 9. Reproducible test instructions

Use a **new disposable Supabase project** with no production data. Confirm the project in the Supabase Dashboard before running; the `*.supabase.co` URL guard is not a substitute for this check.

1. Configure `.env.local` with that project's URL, publishable/anon key, and service-role key. Do not copy production credentials. Keep `.env.local` out of logs and source control.
2. Start the isolated local app on port 3101 from the isolated tracked-source copy using the repository's installed dependencies. The tested startup used Next.js Webpack mode because the temporary external `node_modules` junction was not resolvable by Turbopack.
3. From the repository root, run:

   ```powershell
   node .\tests\security-phase1a-2\verify.mjs --confirm-disposable-project
   ```

4. Preserve the structured request/assertion output securely. It records route paths, labels, statuses, and assertion outcomes; do not add headers, environment values, passwords, or tokens to logs.
5. Review the final cleanup summary. The current runner deliberately retains farms and append-only subscription history and exits nonzero when retirement is required. Retire the disposable project after collecting evidence. Do not remove the immutable trigger, bypass RLS, or weaken foreign keys to make cleanup pass.

Because the runner creates synthetic Auth users and farm data, do not point it at any project that must be retained. The currently configured test project should be retired rather than reused.

## 10. Recommended remediation and next steps

1. Retire the currently used disposable hosted project through the Supabase Dashboard. Synthetic farms and immutable subscription history were retained; current row-level cleanup state could not be rechecked after the connection failed.
2. The post-edit syntax check completed successfully:

   ```powershell
   node --check .\tests\security-phase1a-2\verify.mjs
   ```

3. Re-run the corrected suite only against a fresh disposable project and retain its complete structured output. Confirm the corrected 409 checks, strict 401 replay check, and database state assertions all execute.
4. Decide and document the intended hosted-test lifecycle. A hosted run cannot fully delete its farm fixtures under the current append-only subscription event constraints; use a disposable project that will be retired, or design a safe, isolated test-fixture strategy without weakening production controls.
5. Expand test coverage for every farm-owned table, all four CRUD operations, mismatched farm and record identifiers, role-by-operation combinations, sale payments, financial corrections, inventory movements, all privileged RPCs, invitation acceptance, and suspended/revoked/expired sessions.
6. Add safe CI automation only after the test environment can issue real Auth sessions without production secrets and can be reliably isolated and discarded. Keep local PostgreSQL RLS evidence separate from real Supabase Auth/PostgREST evidence.

## 11. Overall assessment

| Area | Assessment |
|---|---|
| Real Supabase Auth | **Partially verified:** six synthetic password-grant sessions and app cookies obtained |
| Tested tenant isolation | **Observed working in selected scenarios:** representative reads, inserts, updates, deletes, and one RPC |
| Role authorization | **Partially verified:** selected write permissions and owner/manager membership actions observed |
| Session revocation | **Observed working for one sign-out/replay case:** old cookie returned 401 |
| Full multi-tenant readiness | **Unverified:** table/route/RPC coverage is incomplete |
| CI readiness | **Not established:** no GitHub run; corrected runner not rerun; cleanup requires retiring hosted project |
| Production readiness | **Not established by this phase** |

**Conclusion:** The tested cross-tenant and role scenarios did not demonstrate a confirmed authorization bypass. The broader Supabase Auth/API security posture remains unverified until the corrected suite is rerun against a fresh disposable project, cleanup/retirement is controlled, and the outstanding table, route, RPC, and role coverage is completed.
