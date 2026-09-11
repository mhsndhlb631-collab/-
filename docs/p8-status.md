# P8 delivery report

**DECISION: P8 IN PROGRESS — READINESS GATES AND PILOT PENDING.**

| Gate                  | Current state                                                          | Required evidence                                                        |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Environment isolation | Owner-selected single-project pre-data mode; operational rows are zero | A distinct target remains required for the frozen isolation gate         |
| Security              | Hosted boundaries and ES256 fresh-session signing pass                 | Legacy API-key rotation is deferred; independent review remains          |
| Reference load        | PASS: 300/300 reads; overall P95 949 ms and slowest route P95 986.1 ms | Preserve the passing report and repeat after authentication-key rotation |
| Recovery              | Blocked until an isolated recovery target exists                       | `output/p8/recovery.json` PASS and measured RPO/RTO                      |
| Monitoring            | Deployed; consecutive hourly GitHub Actions probes pass                | Continue observation through Pilot                                       |
| Runbooks              | Deploy and migration checks exercised; remaining drills pending        | rollback, incident, recovery, and rotation drills                        |
| User journeys         | P0–P7 have passing hosted evidence; P7 repeated after migration `0031` | Repeat full regression after final environment and secret changes        |
| Pilot                 | Not started                                                            | fourteen consecutive successful operating days                           |

The reference-load pass was recorded at `2026-09-11T04:47:27.761Z` against the
London deployment. The fixture contained exactly 200 students, 10 mentors, 12
weeks, and 20 distinct authenticated users. All fixture rows and temporary Auth
users were removed. Migration `0031_scope_read_indexes` adds indexes used by the
existing mentor/student RLS scope checks; it does not relax any policy.

At `2026-09-11T05:15:27.213Z`, the owner selected continued pre-data operation
on the current Supabase project without branches. The reset removed all 28
operational rows and 222 expired login-attempt buckets while preserving the one
workspace, person, login account, Auth user, 31 migration records, audit events,
and idempotency records. This decision does not convert the frozen environment
isolation or recovery gates into passes.

P8 is not closed by this document. The earliest possible closure is fourteen full days after a properly isolated Pilot starts.
