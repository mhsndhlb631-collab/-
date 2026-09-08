# Local setup and real-environment handoff

FACT: The user confirmed Supabase and Vercel projects have not yet been created. No hosted test has run. Continue independent local foundation work; do not claim P0 complete.

## Local

Use Node 24 and `npm ci`. Copy `.env.example` to ignored `.env.local` and keep local/staging/production separate. `npm run dev` starts the Arabic foundation shell. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke` exercise local gates. Build requires no cloud secrets.

`/health` is process liveness without database access. `/ready` requires an actual safe limited runtime connection and matching foundation migration. It returns a generic 503 otherwise. Readiness does not mean Auth acceptance or P0 completion.

## Dedicated Supabase staging (not yet created)

1. Create a dedicated staging project in the operator's Supabase account. Record region/project reference in a nonsecret deployment note. Do not substitute production.
2. Obtain runtime/migration connection details and Auth keys through provider settings. Secrets are local ignored environment variables or Vercel environment settings. No secrets in chat, source, logs or evidence.
3. Configure `MIGRATION_DATABASE_URL`, APP_ENV=staging and run `npm run db:migrate`. The migrator is separate from runtime and applies reviewed SQL under one transaction/advisory lock. It checks the applied file checksum on rerun.
4. Create a dedicated LOGIN role with a generated password, NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB, and membership in tarbiyah_runtime. It must inherit only that group's safe privileges and own no app tables. Use this login's pooler connection for DATABASE_URL. Never grant the runtime migrator membership.
5. Keep app outside exposed Data API schemas; disable public signup. Add the operator-owned technical Auth email domain. Confirm provider responses/SSR cookies cannot disclose synthetic email to users before implementing login.
6. Prepare isolated linked fixture accounts through a reviewed operator script using Supabase Admin API. A candidate safe sequence is banned Auth creation, local link, then unban; prove provider semantics and crash recovery before accepting it. One active RESPONSIBLE actor and a disposable active linked account with a non-temporary password are required by the spike. Do not insert/update auth tables manually or activate unlinked accounts.

## Original-session spike

Copy the applicable secret variables into `.env.spike.local` (ignored) and add:

```
APP_ENV=staging
SPIKE_ACK_DEDICATED_PROJECT=yes
SPIKE_ACCOUNT_ID=<disposable-linked-account-uuid>
SPIKE_ACTOR_ACCOUNT_ID=<same-workspace-responsible-account-uuid>
SPIKE_PASSWORD=<test-account-password>
```

Run `npm run spike:session`. The script verifies tokens using Supabase getClaims, installs a narrowly granted experimental read accessor, tests original-session semantics against PostgreSQL timestamps, audits advancing the cutoff, then drops the accessor and signs out its test sessions. It never uses refreshed JWT iat as original session time. Its report contains boolean results only. It changes the disposable account cutoff permanently; do not run against a real student's account.

The real spike must pass before building the dependent Auth adapter. A failed spike stops that auth subtask, with evidence and a minimal supported alternative for review. The spike's pass is necessary, not sufficient: provisioning recovery, cookies/privacy, forced credential flow, all roles/scope, pooled context, real concurrent commands, rate limiting and hosted smoke remain required.

## Vercel staging (not yet created)

Create the project from the chosen private Git remote, framework Next.js, Node 24, root directory this repository. Use preview/staging variables only; never give preview production DB access. Do not set MIGRATION_DATABASE_URL in application runtime. Deploy only after the safe Auth/data boundary and local gates pass. Record deployment URL and run hosted Auth smoke before P0 closure.

DECISION: No alternative hosting provider is substituted for the explicitly approved Vercel/Supabase architecture. The local workflow file can be committed now; remote CI cannot run until a repository remote exists.
