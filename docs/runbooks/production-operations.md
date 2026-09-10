# Production operations runbook

## Deploy

1. Confirm the change has a frozen phase contract and no uncommitted secret files.
2. Run formatting, lint, type checking, tests, production build, and artifact smoke.
3. Apply immutable migrations with the dedicated owner connection. Never place that connection in Vercel Runtime.
4. Verify the runtime role and migration checksums.
5. Push the reviewed commit and wait for GitHub Actions and Vercel to succeed.
6. Verify `/health`, `/ready`, and the affected hosted user journeys. Record the commit and deployment timestamp.

The production function region is London (`lhr1`), colocated with the current Supabase `eu-west-2` database region. Treat a database-region move as an infrastructure change and update `vercel.json` in the same reviewed deployment.

## Roll back or forward-fix

For code-only failure, use Vercel Instant Rollback to the last known-good deployment, then run health/readiness and the affected journey. For an additive database change, prefer a reviewed forward-fix migration. Never edit an applied migration. Stop before any destructive database reversal and use the recovery procedure.

## Incident response

1. Record UTC/Cairo time, reporter, visible symptom, affected role/workspace, and safe `request_id`; do not copy secrets or personal data.
2. Classify: critical for privacy leak/data loss/system unavailable; high for a blocked core role journey; medium for degraded work with a workaround; low otherwise.
3. For critical events, stop Pilot acceptance, restrict the affected path, preserve logs, and notify the owner. Restore service before resuming data entry.
4. Use Vercel logs filtered by request ID and status. Use Supabase database/auth logs only with least privilege.
5. Record root cause, corrective action, validation, and whether Pilot day counting restarts.

## Backup and recovery

1. Confirm the latest recoverable point is no older than 24 hours.
2. Restore or clone into a separate Supabase project/database. Never test restoration against Production.
3. Set new custom-role passwords because platform backups may not preserve them.
4. Run all migrations/checksum verification, runtime-role verification, and the recovery canary.
5. Run `/ready`, authentication, role isolation, and representative RESPONSIBLE/MENTOR/STUDENT journeys.
6. Record start/end time. Passing requires an RTO of at most four hours.

## Secret rotation

Rotate any credential that was shared, displayed, or suspected exposed. Rotate Supabase database passwords, API secret keys, rate-limit secret, and deployment credentials independently. Update the local operator file and Production server-only variables, redeploy, then run health, readiness, login, revocation, and role isolation. Remove obsolete values only after the new deployment passes. Never paste a rotated value into chat, Git, logs, or evidence.
