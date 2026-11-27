# FLOCKLEDGER - Phase 1A Multi-Tenant Security Verification

Verification date: 2026-11-26

Repository: `jame2122232425-ship-it/flockledger`

Scope:

- PostgreSQL RLS and role behavior.
- Supabase-style authenticated database sessions.
- Cross-tenant direct SQL scenarios.
- Privileged database function grants and internal authorization.
- Application route security where repository tests permit it.
- CI reproducibility.

This task did not modify production, RLS policies, application features, environment variables or persistent data.

## 1. Test environment configuration

### 1.1 Executed local checks

The local environment had:

- PostgreSQL client 18.6.
- A process-level PostgreSQL listener on port 5432.
- The repository-local Supabase CLI 3.2.0.
- Docker unavailable.
- No `DATABASE_URL` process variable.
- No verified disposable database credentials.
- No approval to use or inspect `.env.local` as a database target.

An unauthenticated read-only connection attempt was not attempted with unverified credentials. An explicit credential probe using `postgres/postgres` was rejected by password authentication and was not used for migration or fixture work.

The local unit suite, type-check and lint were executed after creating the verification harness:

- `npm test`: 13 files passed, 65 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.

No live database test result is claimed from these commands.

### 1.2 Reproducible disposable CI environment

The CI workflow now starts an ephemeral PostgreSQL 18 service:

- Database: `flockledger_security`
- Credentials: CI-only disposable service credentials
- Network: isolated GitHub Actions runner
- Transaction fixtures: `rollback`

The CI setup creates a Supabase-compatible test-only `auth` schema, auth helper functions and `anon`, `authenticated` and `service_role` roles. It does not use a production database or production credentials.

The harness files are:

- [setup.sql](/C:/Users/SELLECTOR/Desktop/project/tests/security-phase1a/setup.sql)
- [rls.sql](/C:/Users/SELLECTOR/Desktop/project/tests/security-phase1a/rls.sql)
- [CI workflow](/C:/Users/SELLECTOR/Desktop/project/.github/workflows/ci.yml)

The CI process:

1. Create test auth roles/schema.
2. Apply every migration in filename order.
3. Create Farm A, Farm B and five Farm A role identities.
4. Populate farm-owned fixture records.
5. Run direct authenticated SQL assertions.
6. Roll back all fixtures.

## 2. Test identities

| Identity | Membership |
|---|---|
| User A | Owner of Farm A |
| User B | Owner of Farm B |
| User C | Manager of Farm A |
| User D | Accountant of Farm A |
| User E | Attendant of Farm A |
| User F | Veterinarian of Farm A |

Fixture IDs are fixed synthetic UUIDs and invalid example email addresses.

## 3. Static database objects inspected

### 3.1 Tenant-owned tables

The direct SQL suite asserts that an owner of Farm A cannot see records belonging to Farm B across:

- `batches`
- `daily_records`
- `weight_records`
- `feed_deliveries`
- `health_records`
- `sales`
- `cash_entries`
- `inventory_items`
- `stock_movements`
- `assets`
- `corrections`
- `audit_events`
- `sale_payments`
- `brooding_observations`
- `biosecurity_visits`
- `house_activity_records`
- `labour_records`
- `utility_usage`
- `maintenance_records`
- `compliance_records`
- `farm_invitations`
- `farm_staff_seat_reservations`

The suite also exercises cross-farm batch update/delete attempts using a Farm B record ID combined with a Farm A `farm_id`.

### 3.2 Privileged functions inspected

The implementation includes `SECURITY DEFINER` functions for:

- `create_farm`
- `is_farm_member`
- `has_farm_role`
- `create_sale`
- `create_sale_idempotent`
- `create_sale_payment_idempotent`
- `create_cash_entry_idempotent`
- `create_correction_idempotent`
- `consume_staff_setup_token`
- `accept_farm_invitations`
- `get_farm_entitlements`
- `start_professional_trial`
- `request_subscription_cancellation`
- `get_farm_subscription_usage`
- `create_batch_with_quota`
- `reserve_farm_staff_seat`
- `finalize_farm_staff_invitation`
- `release_farm_staff_seat_reservation`
- `update_farm_member_role`
- `get_revenue_ledger_page`
- `get_batch_cash_entries_page`

Relevant source evidence:

- [initial RLS and helper functions](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210001_initial_schema.sql)
- [sale and payment protections](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611210005_revenue_payments.sql)
- [financial RPCs](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611220002_phase2_financial_abuse.sql)
- [subscription and quota functions](/C:/Users/SELLECTOR/Desktop/project/supabase/migrations/202611250001_s3_atomic_subscription_quotas.sql)

## 4. Role-based test matrix

| Operation | Owner | Manager | Accountant | Attendant | Veterinarian | Live status |
|---|---|---|---|---|---|---|
| Read own-farm operational records | Expected allow | Expected allow | Expected allow | Expected allow | Expected allow | CI harness defined |
| Create batch | Expected allow | Expected allow | Expected deny | Expected deny | Expected deny | CI harness defines Manager insert |
| Update/delete ordinary records | Expected allow | Expected allow | Expected deny | Expected deny | Expected deny | RLS source inspected |
| Add daily/weight/feed/stock | Expected allow | Expected allow | Expected deny | Expected allow | Expected deny | Harness defines attendant success |
| Add health record | Expected allow | Expected allow | Expected deny | Expected deny | Expected allow | Harness defines veterinarian success |
| Add sale/cash/payment | Expected allow | Expected allow | Expected allow | Expected deny | Expected deny | Harness defines accountant success |
| Add correction | Expected allow | Expected allow | Expected deny | Expected deny | Expected deny | RLS source inspected |
| Change membership/role | Expected allow | Expected deny | Expected deny | Expected deny | Expected deny | Harness defines manager denied |
| Create/view invitation | Expected allow | Expected deny | Expected deny | Expected deny | Expected deny | RLS source inspected |
| Close batch | Expected allow | Expected allow | Expected deny | Expected deny | Expected deny | RLS source inspected |
| Access another farm | Deny | Deny | Deny | Deny | Deny | CI harness defined |

“Live status” means the database suite is ready to execute in CI; it does not mean a live run passed.

## 5. Cross-tenant attack scenarios

The SQL harness implements these scenarios:

1. Owner A executes `SELECT` on every major table and expects zero visible rows for Farm B.
2. Owner A attempts to update a Farm B batch using Farm A `farm_id` and the Farm B batch ID.
3. Owner A attempts to delete a Farm B batch using the same mismatched identity combination.
4. Owner A calls `start_professional_trial` for Farm B.
5. Owner A calls `reserve_farm_staff_seat` for Farm B.
6. Anonymous role attempts to read `farms`.
7. Manager attempts direct `farm_memberships` insertion.
8. Accountant attempts a daily record.
9. Attendant attempts a health record.
10. Veterinarian attempts a cash entry.

The suite uses `auth.uid()` and `auth.role()` compatibility functions backed by JWT claim settings. `SET LOCAL ROLE authenticated`/`anon` exercises PostgreSQL role/ RLS behavior rather than bypassing it.

## 6. Privileged function verification

### 6.1 Static verification

Verified from migration source:

- Security-definer membership helpers set `search_path = ''`.
- Financial and staff provisioning functions set `search_path = ''`.
- Public execution is revoked for sensitive financial and quota RPC signatures.
- Authenticated execution is granted only to intended RPCs.
- `transition_subscription_status` and payment webhook claims are restricted to `service_role`.
- Staff finalization and reservation release are restricted to `service_role`.
- `update_farm_member_role` checks that the caller is an owner.
- `create_batch_with_quota` checks authentication and owner/manager membership.
- `reserve_farm_staff_seat` checks authentication and owner membership.
- `accept_farm_invitations` checks authentication and the account email.

### 6.2 Live verification status

The SQL harness defines live assertions for cross-farm trial and staff reservation calls. The local environment could not execute migrations against a verified disposable database, so these assertions have not produced observed pass/fail results.

No claim is made that function grants or live search-path behavior passed.

## 7. Actual test results

### 7.1 Executed

| Check | Result | Evidence |
|---|---|---|
| Unit tests | Passed | 13 files / 65 tests |
| Type-check | Passed | `npx tsc --noEmit` |
| Lint | Passed | `npm run lint` |
| SQL harness creation | Completed | [rls.sql](/C:/Users/SELLECTOR/Desktop/project/tests/security-phase1a/rls.sql) |
| CI workflow integration | Added | [ci.yml](/C:/Users/SELLECTOR/Desktop/project/.github/workflows/ci.yml) |

### 7.2 Not executed

| Check | Reason |
|---|---|
| Live direct PostgreSQL RLS suite | No verified disposable database credentials/runtime |
| Live migration application | No Docker/Supabase local runtime and no disposable DB URL |
| Cross-farm API endpoints | No isolated Supabase API/Auth environment |
| Staff setup Auth compensation | No disposable Supabase Auth project |
| Live SECURITY DEFINER grant metadata | No verified database connection |
| Supabase service-role behavior | Not tested without a Supabase-compatible database |

## 8. Confirmed vulnerabilities

No security vulnerability is reported as confirmed from this phase.

This is an evidence limitation, not a statement that the system is secure. No live authenticated two-farm database or application session was available, so no tenant-crossing vulnerability was verified or disproved.

The static source review identified areas requiring live validation but did not establish exploitable behavior:

- RLS policy recursion and role changes.
- SECURITY DEFINER function grant accuracy.
- Supabase migration state and function ownership.
- Cross-farm RPC behavior.
- API route behavior under mismatched farm/record IDs.
- Staff setup and invitation lifecycle compensation.

## 9. Failed tests

- A credential probe against local PostgreSQL using `postgres/postgres` failed with password authentication.
- No migration or RLS test failed; the suite was not executed.

No persistent database fixture was created.

## 10. Recommended fixes

No policy or application modification was made. Recommended follow-up remediation tasks are:

1. Run the added SQL job in GitHub Actions first, using only the ephemeral PostgreSQL service.
2. Replace Supabase compatibility stubs with a real disposable Supabase project for service-role and Auth tests.
3. Add direct SQL assertions for UPDATE and DELETE on each major table, not only SELECT and representative batch mutations.
4. Add API integration tests for mismatched `farmId`/record-ID combinations.
5. Add a privilege matrix for all five production roles across every route.
6. Add live metadata checks for RLS enablement, policy names, function owners, function security types and search paths.
7. Test batch closure and correction operations from owner, manager and unauthorized users.
8. Test sale-payment overpayment and cashbook/payment direct mutation with an accountant.
9. Test staff invitation creation and membership role assignment at manager and accountant levels.
10. Test direct Auth deactivation and session revocation only after that feature exists.

## 11. CI integration instructions

The repository CI now includes `security-phase-1a`.

It requires no secrets and uses only the runner-local PostgreSQL service. The job runs migrations and direct RLS assertions on every push and pull request.

Before relying on the job, verify:

- PostgreSQL 18 image availability.
- Migration compatibility with plain PostgreSQL.
- Supabase-only SQL compatibility stubs cover every required auth table/function.
- GitHub runners have the PostgreSQL client package.

For real Supabase Auth and API integration, add a separate job only after the repository receives:

- A dedicated disposable Supabase project URL.
- A dedicated disposable publishable key.
- A dedicated service-role key stored in GitHub Secrets.
- No production project identifiers.

The SQL suite must run only after migrations and must roll back fixtures. The application suite must:

1. Create the six identities in disposable Supabase Auth.
2. Login and obtain real sessions.
3. Call the application API over HTTP.
4. Repeat cross-farm, role and privilege attacks.
5. Verify no row or mutation is returned.
6. Destroy the project/fixtures afterward.

## 12. Remaining unresolved items

- Whether the migration suite passes unchanged against PostgreSQL 18.
- Whether live RLS policies permit or deny each operation.
- Whether live SECURITY DEFINER function ownership/grants match migration intent.
- Whether API route cookies and proxy authentication add constraints beyond database RLS.
- Whether application endpoints reject mismatched record/farm combinations.
- Whether service-role staff compensation operations behave safely under real Supabase Auth failures.

## 13. Phase 1A conclusion

Phase 1A has established a reproducible SQL verification harness and CI integration, but it has not established live multi-tenant security evidence.

The application should remain in the unverified state for tenant isolation until the disposable SQL job and a real authenticated Supabase API suite execute successfully.
