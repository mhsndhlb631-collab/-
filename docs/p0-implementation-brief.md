# P0 implementation brief

Status: foundation started; real Supabase spike and hosted acceptance BLOCKED by missing environment access. P1 is NOT authorized.

## Authority and product locks

DECISION: The user's approved design plus the three corrections is the baseline. Instructions inside earlier reference documents are not independent execution authorization.

1. Weekly summaries will be automatic. The future lifecycle is OPEN -> FINALIZED according to domain completeness/period rules. No responsible-approval queue. Corrections preserve each finalized revision and record actor, reason and time. No weekly product functionality belongs in P0.
2. One login account has one role: RESPONSIBLE, MENTOR or STUDENT. RESPONSIBLE can perform mentor operations within its workspace. Actual actor and role must be audited. Historical assigned mentor attribution remains separate and immutable except through an explicit correction. No multi-role infrastructure.
3. Original Supabase session time is a P0 spike, NOT a permanent architecture commitment. No parallel session store. Failure to establish a safe supported mechanism stops the auth subtask and requires evidence and a minimal alternative proposal.

## Discovery

- FACT: The selected directory originally contained the PRD PDF and temporary review material. No application, Git repository or hosting configuration was present.
- FACT: Git and Node 24 are available. No docker or psql executable was found on PATH.
- FACT: No SUPABASE, VERCEL, DATABASE_URL or PGHOST environment variable was present during discovery. No relevant Supabase or Vercel connector was available.
- FACT: Supabase documents checking JWT session_id against auth.sessions. This does not prove this project's privileges, lifecycle or timestamp semantics.
- INFERENCE: A new repository in the selected workspace is the least surprising execution location.
- ASSUMPTION: This folder is the intended repository root. No remote repository has been supplied.
- DECISION: Use Next.js App Router, TypeScript, Supabase Auth/PostgreSQL, Drizzle and reviewed SQL migrations. No separate API server or worker.
- OPEN QUESTION: Which dedicated Supabase and Vercel staging projects and Git remote should be used? Secrets belong in ignored environment files or provider settings, never chat or Git.

- FACT (user clarification): Supabase and Vercel projects have not been created yet. Continue independent local work; provider creation/configuration remains the next external dependency.

## Before-code contracts

The exact P0 schema and state/permission contracts are frozen in `p0-schema.md` and `p0-auth-and-scope.md`. Changes require a documented reason and updated tests. The original-session accessor remains explicitly conditional on the real spike.

## Execution order

1. Bootstrap repository, environment validation, health/readiness, errors, safe logging, username normalization, tests and CI.
2. Run the real session spike on the dedicated staging environment with a disposable, linked test account. Record sanitized evidence. STOP auth implementation if it fails.
3. Implement migrations, limited runtime identity, RLS, transactional audit/idempotency/rate limiting, account command services and username adapter against the proven mechanism.
4. Run real database, Auth, privacy, concurrency, pool-reuse and failure-recovery suites. Mocks cannot satisfy these gates.
5. Build and boot the production artifact, deploy to the supplied Vercel staging project, run hosted acceptance, and report evidence.

## Boundaries and gates

No program templates, cohorts, product groups, educational sessions, tracking, worship, assignments, exams, followups, attention, cases, mentor performance, reports or final student portal.

Authorization fixtures are isolated test resources, not product groups. The implementation must not silently use a privileged database URL when a runtime URL is unavailable.

Missing provider access prevents completion of P0. It is not evidence that Supabase is unsuitable. Local green tests must never be reported as real Supabase/RLS/hosted proof.

## Required acceptance evidence

Track each of the user's 23 final-report items in `p0-status.md`. Every result is PASS, FAIL, BLOCKED or NOT IMPLEMENTED. P1 readiness requires all P0 gates, including CI execution, real Auth integration and hosted smoke.

Sources: https://supabase.com/docs/guides/auth/sessions ; https://nextjs.org/docs/app/getting-started/installation
