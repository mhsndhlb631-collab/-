# P6 delivery report — responsible center, mentor performance, and reports

**DECISION: P6 CLOSED. P7 NOT STARTED.**

| Gate                    | Final evidence                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsible center      | Hosted acceptance proves workspace counts for overdue sessions, active attentions, actions, and cases, plus mentor drill-down.                                                                                 |
| Performance model       | `mentor-performance-v1` calculates operational commitment 35%, qualified follow-up 30%, data completeness 20%, and case response 15%. One follow-up cannot satisfy multiple attention opportunities.           |
| Data semantics          | Zero-denominator dimensions are excluded and remaining weights are normalized. No opportunities yields no score; fewer than five yields `LIMITED_DATA`. Student grades do not affect mentor performance.       |
| Attribution and history | Opportunities remain attributed to the mentor effective at the session or obligation time. Generated snapshots preserve rules version, dimensions, evidence, score, and request identity and are immutable.    |
| Reports and export      | Student-week, group-week, mentor-week, and program reports pass through hosted HTTP. CSV export is bounded, audited, and excludes internal notes, case problem text, credentials, and session material.        |
| Privacy and scope       | P6 resources are responsible-only inside the workspace. Hosted acceptance proves mentor/student denial and cross-workspace isolation. Forced RLS and revoked Data API access cover snapshot and export tables. |
| Audit and immutability  | Hosted acceptance proves atomic performance/export audit events and rejects mutation of persisted performance snapshots and export records.                                                                    |
| Database                | Supabase migrations `0028_p6_reporting_foundation.sql` and `0029_p6_reporting_security.sql` are applied with matching checksums; the limited runtime role and RLS verification pass.                           |
| Automated checks        | Formatting, lint, typecheck, production build, artifact smoke, and 131 tests across 12 files pass. GitHub Actions run `34462009586` passed.                                                                    |
| Hosted acceptance       | `output/p6/acceptance.json` passed all eight sanitized evidence groups at `2026-09-10T09:43:06.875Z`; exact database and Auth fixtures were removed.                                                           |
| Deployment              | Vercel production deployment for implementation commit `0ab7a2f` is Ready and serves the main aliases.                                                                                                         |

P6 is closed at implementation commit `0ab7a2f`. P7 final role journeys, full mobile/RTL/accessibility closure, and complete loading/error/recovery experience remain outside this delivery and have not started.
