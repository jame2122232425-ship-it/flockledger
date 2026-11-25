# Production deployment checklist

The selected target is Vercel with a separate production Supabase project and
Supabase's default Auth email delivery. This repository does not contain
production project identifiers or credentials, and no account settings were
changed. Edge/WAF and monitoring providers are deferred; the production
Supabase backup/PITR plan has not yet been confirmed.

## Vercel project setup

- Connect the repository to Vercel using the existing Next.js framework
  detection. Keep deployment credentials and production environment variables
  in Vercel's protected project settings, not GitHub Actions or source files.
- Set distinct environment variables for Preview and Production. Preview builds
  must use a non-production Supabase project and must never receive the
  production service-role key or production database URL.
- Configure `NEXT_PUBLIC_APP_URL` to the canonical production HTTPS origin and
  register the production and preview callback/redirect URLs in Supabase Auth.
- Review which branch Vercel treats as Production and protect that branch with
  the CI check before enabling automatic production deployments.
- The repository's GitHub Actions workflow validates code but does not deploy.
  Vercel's Git integration can build previews and production deployments once
  the project is connected and configured.

## Secrets and environments

- Keep separate Supabase projects and credentials for local development,
  staging, and production.
- Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_APP_URL` in the hosting
  provider's encrypted environment settings. Add `DATABASE_URL` only to a
  trusted migration runner that needs direct database access.
- Never add real values to `.env.example`, source control, build logs, support
  tickets, or chat. The service-role key and database password must remain
  server-side.
- Rotate credentials that have appeared in tracked files, Git history, logs,
  or shared locations. Revoke old values after verifying the replacement.
- Set `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin. Configure the same
  origin and required redirect URLs in Supabase Auth.

## Auth, email, cookies, and headers

- Supabase's default Auth email delivery is the selected initial option.
  Configure confirmation and password-reset templates, redirect allowlists,
  and abuse protection; verify the current provider limits and delivery
  behavior before launch. Move to custom SMTP if the default service does not
  meet production volume or deliverability needs.
- Verify production sessions use HTTPS, secure cookies, suitable SameSite
  behavior, and reviewed session lifetimes.
- Inspect deployed response headers and test the CSP against all required
  application flows. Do not add broad CSP exceptions without browser evidence.
- Confirm production `script-src` does not include `'unsafe-eval'`; it is only
  enabled for local development to support React diagnostics.

## Database release and recovery

- Apply migrations in filename order to a disposable/staging project first.
- Review the migration diff, grants, RLS policies, function signatures, and
  data-impact before production approval.
- Run migrations from a trusted CI/deployment environment with protected
  credentials; do not expose `DATABASE_URL` to client builds or pull-request
  jobs.
- Define backup retention and point-in-time recovery for the selected Supabase
  plan. Record an owner, recovery objectives, and an escalation path.
- Perform and document a restore drill in an isolated project before launch.
- Do not assume a migration rollback is safe when it can discard or transform
  data; prepare and review a forward-recovery plan.

## Abuse protection and observability

- Add hosting-edge/WAF limits for sign-in, sign-up, staff setup, invitations,
  and financial mutations. Database attempt counters are not DDoS protection.
- Alert on authentication abuse, repeated authorization failures, elevated
  API/database errors, failed migrations, and backup/recovery failures.
- Use structured server logs with request IDs. Redact credentials, auth
  tokens, database URLs, and unnecessary personal or financial data.
- Configure an error-reporting destination and verify that source maps and
  captured request data follow the project's privacy requirements.

## Legal and launch review

- Obtain legal/privacy review of the draft Privacy Policy, Terms of Service,
  and Data Security page before public launch.
- Confirm support contacts, data-retention/deletion practices, incident
  response ownership, and applicable jurisdictional requirements.

## Current repository automation

`.github/workflows/ci.yml` runs type-checking, lint, unit tests, and a production
build on pushes and pull requests with nonfunctional placeholder values. It
does not deploy the application, apply database migrations, or access
production secrets.
