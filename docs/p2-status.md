# P2 delivery report — educational sessions

**DECISION: P2 COMPLETE. P3 NOT STARTED.**

| Gate                    | Final evidence                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definitions             | Published plan input supports typed session definitions and metrics with required/applicability rules and value constraints.                                         |
| Independent cohort copy | Definitions and metrics copy into the cohort plan; occurrences reference the copied definitions.                                                                     |
| Generation              | Cohort creation generates exactly one occurrence for every copied definition/group pair using the workspace timezone. A database unique key prevents duplicates.     |
| Lifecycle               | `PLANNED -> OPEN -> CLOSED`, with documented `CANCELLED` from planned/open. Closed sessions never reopen.                                                            |
| Frozen roster           | Opening freezes enrollments and memberships effective at the scheduled start. A later enrollment does not enter the historical roster.                               |
| Mentor attribution      | The primary mentor effective at the session time is frozen on open. RESPONSIBLE may operate without rewriting that attribution.                                      |
| Partial save            | Attendance and typed metric records save atomically in batches up to 200 roster rows with optimistic row versions.                                                   |
| Complete close          | Required attendance and applicable required metrics are checked under a row lock. Missing facts return `INCOMPLETE_SESSION` and leave the occurrence open.           |
| Retry and concurrency   | Idempotency replays the winning close result. Concurrent closes with different keys produce one success and one state conflict.                                      |
| Correction              | A post-close correction requires a reason and stores immutable before/after snapshots, actor, request, and audit event.                                              |
| RLS/privacy             | Forced RLS restricts occurrences by group, roster facts by operational assignment, and students to their own frozen roster row. Data API roles have no table access. |
| Real acceptance         | `output/p2/acceptance.json` contains boolean evidence only. The full local/real-Supabase lifecycle passes and removes its exact fixture.                             |
| Automated checks        | 111 tests, formatting, lint, typecheck, production build, and artifact smoke pass.                                                                                   |

Migrations `0009` through `0015` are applied with checksum verification. P3 tracking, worship/habit schedules, multi-source entry, and review are outside this delivery.
