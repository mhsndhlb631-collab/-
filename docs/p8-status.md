# P8 delivery report

**DECISION: P8 IN PROGRESS — READINESS GATES AND PILOT PENDING.**

| Gate                  | Current state                                                          | Required evidence                                                            |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Environment isolation | Blocked: one Supabase project is currently configured                  | `output/p8/environments.json` PASS with distinct targets                     |
| Security              | Automated hosted boundaries and internal review pass                   | Rotate exposed values, migrate legacy signing, and obtain independent review |
| Reference load        | PASS: 300/300 reads; overall P95 949 ms and slowest route P95 986.1 ms | Preserve the passing report and repeat after authentication-key rotation     |
| Recovery              | Blocked until an isolated recovery target exists                       | `output/p8/recovery.json` PASS and measured RPO/RTO                          |
| Monitoring            | Deployed; consecutive hourly GitHub Actions probes pass                | Continue observation through Pilot                                           |
| Runbooks              | Deploy and migration checks exercised; remaining drills pending        | rollback, incident, recovery, and rotation drills                            |
| User journeys         | P0–P7 have passing hosted evidence; P7 repeated after migration `0031` | Repeat full regression after final environment and secret changes            |
| Pilot                 | Not started                                                            | fourteen consecutive successful operating days                               |

The reference-load pass was recorded at `2026-09-11T04:47:27.761Z` against the
London deployment. The fixture contained exactly 200 students, 10 mentors, 12
weeks, and 20 distinct authenticated users. All fixture rows and temporary Auth
users were removed. Migration `0031_scope_read_indexes` adds indexes used by the
existing mentor/student RLS scope checks; it does not relax any policy.

P8 is not closed by this document. The earliest possible closure is fourteen full days after a properly isolated Pilot starts.
