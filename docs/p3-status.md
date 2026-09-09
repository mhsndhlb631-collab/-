# P3 delivery report — tracking and progression

**DECISION: P3 COMPLETE. P4 NOT STARTED.**

| Gate                    | Final evidence                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definitions             | Published plans support typed worship, habit, value, and goal definitions with scalar validation, bounds, enum options, source permissions, review policy, and progression weight.                                          |
| Independent cohort copy | Definitions and schedules copy into the cohort plan. Live entitlements do not depend on later template changes.                                                                                                             |
| Entitlements            | Daily and weekly requirements derive from cohort week, workspace timezone, schedule range, weekdays, and due time. Missing records stay missing instead of becoming zero.                                                   |
| Student entry           | A student can read and record only their own eligible requirements using the `STUDENT` source. Students cannot self-exempt or use mentor/paper modes.                                                                       |
| Mentor entry            | Assigned mentors can save one student or an atomic batch of up to 200 entries. RESPONSIBLE keeps workspace scope while every record preserves the actual actor and source.                                                  |
| Paper transcription     | Weekly summaries are accepted only for weekly definitions that explicitly permit them and never fabricate daily records.                                                                                                    |
| Review and correction   | Reviews bind to an immutable entry version. Corrections create immutable revisions, reset required review to pending, and reject stale entry or row versions with HTTP 409.                                                 |
| Concurrency             | `row_version` is compared numerically across the bigint database boundary. The guarded transition updates review status only and preserves the original recorder.                                                           |
| RLS and privacy         | Forced RLS protects definitions, schedules, entries, revisions, and reviews. Student enrollment visibility is limited to the student's own enrollment. Data API roles have no table privileges.                             |
| Atomicity and audit     | Invalid batch input persists no partial rows. Successful writes and reviews create audit events in the same transaction.                                                                                                    |
| Real acceptance         | Hosted Vercel/Supabase acceptance passed all student, mentor, paper, review, stale-version, isolation, audit, and exact-fixture-cleanup proofs. Evidence is stored locally in `output/p3/acceptance.json` as booleans only. |
| Deployment              | Supabase migrations `0016` through `0020` are applied. GitHub Actions, production build, artifact smoke, Vercel `/health`, and database `/ready` are release gates.                                                         |

P4 reporting, dashboards, alerts, and downstream analytics remain outside this delivery.
