# P1 delivery report — program setup and distribution

**DECISION: P1 COMPLETE. P2 NOT STARTED.**

P1 adds the operating structure required before sessions and weekly execution: reusable program templates, immutable versioned plans, cohort copies, groups, enrollments, and effective-time student and mentor assignments.

| Gate                      | Evidence                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two different programs    | Real acceptance creates a two-week foundation program and a four-week advanced program with different week types and objectives.                                                                                                  |
| Immutable cohort copy     | A cohort copies template plan version 1. Publishing version 2 later leaves the cohort copy linked to version 1 with its original two weeks. Database triggers reject edits to published plans and their weeks.                    |
| Cohorts and groups        | Real HTTP commands create two cohorts and their groups atomically through the limited runtime role.                                                                                                                               |
| Student history           | Moving a student closes the prior group membership at the effective instant and creates the new row; overlap triggers serialize and reject conflicting ranges.                                                                    |
| Mentor history            | Reassignment closes the prior mentor assignment and creates the new effective row while preserving attribution history.                                                                                                           |
| Authorization and privacy | RESPONSIBLE can administer its workspace. MENTOR and STUDENT overview queries expose only currently assigned cohorts/groups. Templates remain responsible-only. Every P1 table uses forced RLS.                                   |
| Idempotency and audit     | Mutations require a scoped idempotency key, replay a completed result, reject hash conflicts, and append an audit event in the same transaction. The actor can read only its own idempotency records.                             |
| Database                  | Migrations `0006`–`0008` are applied to Supabase with checksum verification. Runtime access uses the limited `tarbiyah_runtime` role.                                                                                             |
| Automated checks          | 110 tests across 9 files, lint, typecheck, production build, and artifact smoke pass.                                                                                                                                             |
| Real acceptance           | The ignored `output/p1/acceptance.json` records only booleans and a timestamp. It passes program variance, copy stability, assignment history, role scope, idempotency, and atomic audit, then removes the exact current fixture. |
| Delivery                  | GitHub Actions and the production Vercel alias are verified after the final commit.                                                                                                                                               |

The initial shared Supabase/Vercel environment remains the owner-selected deployment target. P2 sessions, attendance, execution tracking, weekly summaries, and later product stages are outside this delivery.
