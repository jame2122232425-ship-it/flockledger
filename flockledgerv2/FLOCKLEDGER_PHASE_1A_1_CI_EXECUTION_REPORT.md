# FlockLedger — Phase 1A.1 CI Execution Report

**Execution date:** 2026-11-26
**Repository:** `jame2122232425-ship-it/flockledger`
**Scope:** Disposable PostgreSQL migration replay and database-level tenant-isolation harness only

## Executive result

The Phase 1A SQL harness was executed against a fresh, disposable PostgreSQL 18.6 database. All 18 repository migrations applied, all **52 SQL assertions passed**, the deliberate insecure-policy negative control failed with its expected detector marker, and fixture cleanup was verified.

This establishes observed PostgreSQL-native RLS and database-role behavior for the scenarios listed below. It does **not** establish end-to-end Supabase Auth, PostgREST, application API, or full production tenant security. GitHub Actions itself was not run from this environment; the local replay is not a GitHub Actions run.

The earlier Phase 1A report's execution status describes the state before this run. This report supersedes that status while preserving the original report as a historical record.

## 1. Environment and execution identity

| Item | Result |
|---|---|
| Database engine | PostgreSQL 18.6 |
| Database | Fresh disposable database `flockledger_phase1a_replay` on the local test-only PostgreSQL cluster |
| Connection | Loopback `127.0.0.1:55432`; local disposable-cluster trust authentication |
| Test identities | Six synthetic users using reserved `.invalid` email addresses |
| Supabase compatibility | Test-only `auth` schema, `auth.uid()`/`auth.role()` claim-setting helpers, and `anon`, `authenticated`, `service_role` roles |
| Persistent fixture handling | RLS suite and negative-control fixture both run in transactions and roll back |
| Local run identifier | `flockledger_phase1a_replay` |
| GitHub Actions run identifier | **Unavailable — no GitHub Actions run was initiated** |
| GitHub CLI / Docker | Not available in the execution environment |

No production URL, credentials, data, or project was used. The disposable replay database was dropped after verification. The local disposable PostgreSQL cluster used for this task was separate from application/production resources.

## 2. Workflow and migration execution

The `security-phase-1a` job in `.github/workflows/ci.yml` was reproduced locally against a newly created database:

1. Created the test-only auth schema, helper functions, and roles.
2. Applied every SQL file in `supabase/migrations/` in filename order.
3. Executed `tests/security-phase1a/rls.sql`.
4. Executed `tests/security-phase1a/negative-control.sql` and checked its nonzero exit and expected marker.
5. Verified fixture rollback and dropped the replay database.

**Migration result:** 18 of 18 migrations applied successfully. No migration failure occurred in the final clean replay.

**GitHub Actions result:** Not executed. This environment could not start a hosted workflow or obtain a GitHub run ID. The local result must not be presented as a hosted CI run.
No `actionlint` or YAML parsing library was available for a standalone workflow syntax check; the workflow was inspected, but hosted runner validation remains outstanding.

## 3. Harness defects found and addressed

The harness/CI changes are limited to test setup, fixtures/assertions, and the workflow. No application authorization code or production database policy was changed.

- **Cluster-global test roles prevented a second database replay.** A fresh database on the same PostgreSQL cluster failed because `anon` already existed at cluster scope. `tests/security-phase1a/setup.sql` now handles only PostgreSQL's expected `duplicate_object` condition when creating test roles, allowing repeat runs.
- **A relation without authenticated SELECT privilege could be misread as an RLS result.** The SELECT loop treats `insufficient_privilege` as a database-level access denial rather than claiming that RLS filtered rows. This distinction is especially relevant to `farm_staff_seat_reservations`.
- **Test-block syntax defects** in exception handling and a missing conditional terminator were corrected before the successful replay.
- **The cross-farm UPDATE/DELETE assertions now exercise both ID patterns:** a Farm B record ID paired with Farm A's authorized `farm_id`, and the actual Farm B `farm_id` plus Farm B record ID.
- **An insert referencing Farm B's inventory item** was added to check the related-record tenant guard.
- The negative-control workflow step accepts failure only when the expected `DETECTOR_CAUGHT_BROKEN_RLS` marker is present; an unrelated SQL error fails the job.

The initial clean replay attempt did fail at setup because of the cluster-global role collision. That was a harness setup failure, not a failed tenant-isolation assertion. The corrected clean replay then completed successfully.

## 4. Assertions and observed results

### Verified and passed

- **52/52 recorded SQL assertions passed** in the final replay.
- Owner A could not see Farm B rows in the 27 relation checks listed below. The `farm_staff_seat_reservations` check was blocked by SQL privilege denial rather than demonstrated by RLS; it is not counted as evidence of that table's RLS behavior.
- Owner A could not see Farm B's `farms` row or Farm B membership rows.
- Owner A's UPDATE and DELETE affected zero Farm B batch rows both when supplying Farm A's `farm_id` with the Farm B record ID and when supplying the actual Farm B `farm_id` and record ID.
- Farm A could not insert a daily record attached to Farm B's batch, insert into Farm B's tenant, or reference Farm B's inventory item in a Farm A stock movement.
- Manager C could create a Farm A batch through the quota RPC, but could not directly insert a membership or promote themself to owner.
- Accountant D could create a sale and cash entry but was denied a daily record.
- Attendant E could create a daily record but was denied a health record.
- Veterinarian F could create a health record but was denied a cash entry.
- Owner A's cross-farm calls to `start_professional_trial`, `reserve_farm_staff_seat`, and `create_batch_with_quota` were rejected.
- The anonymous database role was denied access to `farms`.
- Live catalog assertions confirmed that all public `SECURITY DEFINER` functions had an empty `search_path`, and checked selected function execution grants for `anon`, `authenticated`, and `service_role`.
- The intentionally permissive RLS policy triggered `DETECTOR_CAUGHT_BROKEN_RLS`; the test runner confirmed the expected nonzero result and marker.
- Post-test checks returned zero fixture users, zero fixture farms, and no remaining negative-control table. The replay database was then dropped.

### Relation SELECT checks

The SELECT loop covered `batches`, `daily_records`, `weight_records`, `feed_deliveries`, `health_records`, `sales`, `cash_entries`, `inventory_items`, `stock_movements`, `assets`, `corrections`, `audit_events`, `sale_payments`, `brooding_observations`, `biosecurity_visits`, `house_activity_records`, `labour_records`, `utility_usage`, `maintenance_records`, `compliance_records`, `farm_invitations`, `farm_staff_seat_reservations`, `farm_subscriptions`, `subscription_payments`, `subscription_invoices`, `subscription_events`, and `subscription_usage`.

The two `farms` and `farm_memberships` checks are separate from that loop. A passing zero-row query proves invisibility for its tested query and fixture; it does not prove that every operation on that table is correctly authorized.

## 5. Role-based test matrix

| Role | Executed behavior | Result |
|---|---|---|
| Owner A | Cross-tenant SELECT, UPDATE, DELETE, INSERT/reference attempts; selected cross-farm RPCs | Denied as expected in tested scenarios |
| Owner B | Created Farm B fixtures | Fixture owner only; broad permissions were not tested |
| Manager C | Farm A batch creation RPC; direct membership insert; self-promotion to owner | Batch creation allowed; membership changes denied |
| Accountant D | Farm A sale and cash-entry inserts; daily-record insert | Financial inserts allowed; daily record denied |
| Attendant E | Farm A daily-record insert; health-record insert | Daily record allowed; health record denied |
| Veterinarian F | Farm A health-record insert; cash-entry insert | Health record allowed; cash entry denied |
| Anonymous | Read from `farms`; selected function grants checked | Table access denied; selected privileged grants absent |
| `service_role` | Function execution grant metadata only | Selected staff-finalization grant present; no service-role transaction behavior tested |

This is a focused permission matrix, not an exhaustive role-by-operation test of every endpoint, table, or mutation.

## 6. Privileged functions

### Verified through database execution

- Cross-farm rejection by `start_professional_trial`, `reserve_farm_staff_seat`, and `create_batch_with_quota`.
- Empty `search_path` metadata for every public `SECURITY DEFINER` function present after migrations.
- Selected `EXECUTE` privilege checks:
  - `anon` cannot execute `start_professional_trial`.
  - `authenticated` can execute `start_professional_trial`.
  - `service_role` can execute `finalize_farm_staff_invitation`.
  - `authenticated` cannot execute `finalize_farm_staff_invitation`.
  - `anon` cannot execute `transition_subscription_status`.

### Not established

The suite did not exhaustively invoke every privileged function, verify each function owner's identity, test service-role function behavior, or prove that every grant matches product intent. Catalog assertions and successful selected calls are limited evidence, not a comprehensive function audit.

## 7. Failed and skipped tests

### Failed during harness development

- A preliminary replay against a second database failed because setup attempted to create the already-existing cluster-global `anon` role. The setup was corrected and the clean replay passed afterward.
- Earlier harness runs exposed a SELECT privilege-denial classification problem and SQL exception-block syntax errors. These were corrected before the final clean replay.

### Not executed

- **GitHub Actions hosted run:** unavailable from this environment; no run identifier exists.
- **Application API endpoints:** no isolated Supabase API/Auth service was configured, so HTTP requests with real user sessions were not run.
- **Real Supabase Auth/JWT behavior:** `auth.uid()`/`auth.role()` were compatibility functions reading test claim settings. No JWT signature, PostgREST request pipeline, Supabase Auth issuance, or session revocation was tested.
- **Exhaustive per-table INSERT/UPDATE/DELETE:** mutations were tested on representative sensitive relations, not every tenant-owned table and operation.
- **Full privilege matrix:** not every role/function/table combination was exercised. In particular, Owner B's authorization behavior and comprehensive role-specific SELECT/UPDATE/DELETE behavior remain untested.
- **Batch closure authorization, payment correction/overpayment behavior, membership invitations through Auth, and production service-role workflows:** fixtures or selected grants may touch related schema, but those full behaviors were not tested as authenticated end-to-end actions.
- **Concurrency, duplicate submission/idempotency under races, and performance:** not part of this execution.
- **Supabase-specific extensions/services and API gateway behavior:** not represented by plain PostgreSQL compatibility objects.

No skipped test is reported as passed.

## 8. Confirmed vulnerabilities

No cross-tenant access or privilege-escalation vulnerability was observed in the tested PostgreSQL scenarios. The negative control confirms that the harness detects the specific intentionally permissive SELECT policy used by that control.

This is not a claim that the entire application or Supabase deployment is secure. Coverage limits above leave API authorization, real Supabase Auth behavior, untested table mutations, and untested privileged functions unresolved.

## 9. CI integration and reproducibility

The `security-phase-1a` job is configured in `.github/workflows/ci.yml` to start a disposable PostgreSQL 18 service, bootstrap the test auth compatibility layer, apply migrations, run the SQL suite, and require the negative-control marker. The database service is isolated to the CI job and does not use repository secrets.

To obtain a hosted run, commit and push the branch containing these changes (or open/update a pull request). The workflow currently triggers on `push` and `pull_request` (not `workflow_dispatch`). After pushing, retrieve the run and its logs with:

```sh
git push origin <branch-name>
gh run list --workflow ci.yml --branch <branch-name> --limit 5
gh run view <run-id> --log
```

The hosted run should be recorded separately from this local PostgreSQL replay. A successful local replay does not substitute for checking GitHub Actions' service startup, package installation, and workflow execution result.

## 10. Remaining risks and next steps

1. Run the workflow in GitHub Actions and append its actual run ID and result.
2. Add a disposable Supabase environment for real Auth sessions and application API integration; keep its credentials isolated from production.
3. Expand cross-tenant UPDATE/DELETE and attempted INSERT coverage across all tenant-owned relations, with fixture-presence assertions so zero-row checks cannot pass vacuously.
4. Add role-specific API tests and database tests for batch closure, invitation lifecycle, membership changes, sale payments, cashbook corrections, and inventory movements.
5. Test selected privileged functions using both authenticated and service-role identities, including invalid identity, wrong role, and cross-farm record IDs.
6. Keep PostgreSQL-native RLS evidence separate from Supabase Auth/PostgREST evidence in CI reporting.

## 11. Final assessment

**Database-level status:** PostgreSQL 18.6 migrations and the current focused RLS/role suite passed on a fresh disposable database, with a working negative control and verified rollback.

**Tenant-isolation status:** Verified for the enumerated SELECT and representative mutation/RPC scenarios only. Full multi-tenant security remains **partially verified**, not globally proven.

**CI status:** Workflow configuration exists and its database steps were reproduced locally. Hosted GitHub Actions execution remains **not executed**.
