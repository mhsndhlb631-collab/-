# P1 contract — program and distribution

**Status: frozen before P1 implementation.** P0 authentication, runtime-role and audit boundaries remain authoritative.

## Scope

P1 implements program templates, immutable plan versions, cohorts, plan weeks, groups, enrollments, effective-time group membership and effective-time primary mentor assignment. It does not implement educational sessions, tracking, weekly summaries or reports.

## Decisions

- Every record belongs to one workspace and every cross-record foreign key includes that workspace.
- A template owns published reference plan versions. A cohort receives a copied plan; later template edits never mutate the cohort copy.
- A plan is editable only while `DRAFT`. Publishing freezes that version. Revision creates a new version with `copied_from_plan_id`; historical versions stay readable.
- Cohort and group archival preserves enrollments and assignments.
- Enrollment, group membership and mentor assignment are effective-time records. Moving a student or mentor closes the old row and creates a new row; history is never overwritten.
- At one instant an enrollment has at most one group membership and a group has at most one primary mentor. PostgreSQL trigger locks serialize overlap checks.
- RESPONSIBLE performs P1 writes inside its workspace. MENTOR reads assigned groups and their current students. STUDENT reads only the cohort/group reached from its own enrollment.
- Client input never supplies actor role or workspace. Verified P0 account/session context supplies both.
- P1 commands require a request ID, row version for updates and an idempotency key where a retry could duplicate a record.

## Close gate

P1 closes only after two materially different program fixtures can be created, copied to cohorts, revised independently, distributed to groups, and queried under RESPONSIBLE/MENTOR/STUDENT RLS while preserving the earlier plan and assignment history. Local gates, clean migrations, real Supabase acceptance, CI, production artifact and Vercel smoke must pass.
