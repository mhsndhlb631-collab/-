# P6 contract — responsible center, mentor performance, and reports

**Status: frozen before P6 implementation.** P0–P5 identity, historical attribution, privacy, concurrency, audit, and scope boundaries remain authoritative.

## Scope

P6 implements the responsible center, evidence-backed mentor performance, trends through immutable snapshots, student/group/mentor/program reports, limited audited CSV export, and responsible audit browsing. It does not implement the final role journeys, broad mobile/RTL accessibility closure, load/security/recovery gates, or P7/P8.

## Performance rules `mentor-performance-v1`

| Dimension              | Weight | Opportunity                                                                          | Achieved on time                                                                 |
| ---------------------- | -----: | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Operational compliance |    35% | A session ending in the selected period while the mentor was effective for its group | Closed no later than 24 hours after its end                                      |
| Follow-up              |    30% | An attention item attributed to the mentor and created in the period                 | A qualified, non-cancelled follow-up within 72 hours after signal creation       |
| Data completeness      |    20% | An expected roster row in a due session attributed to the mentor                     | Attendance is recorded and every applicable required session metric has a record |
| Case response          |    15% | A case action owned by the mentor and due in the period                              | Completed by its due time, or the case was escalated by its due time             |

Each dimension is `achieved / opportunities × 100`. A zero-denominator dimension is excluded. The total is the weighted mean of applicable dimensions. Zero total opportunities returns no score and “no evaluation data”. Fewer than five total opportunities is marked “limited data”. Student grades and learning scores are never inputs.

Attribution uses the mentor assignment effective at the obligation time. Historical obligations never move silently after reassignment. Every dimension returns evidence identifiers, due time, and achieved state for drill-down. Every generated score persists an immutable snapshot with its rule version.

## Permissions and exports

- RESPONSIBLE may read the center, mentor list/performance, all four report types, audit browse, and export inside the workspace.
- MENTOR and STUDENT receive no P6 performance, team report, export, or audit resource.
- Report export supports documented report types and CSV only, records metadata and an atomic `REPORT_EXPORTED` audit event, and never exports internal notes, case problem text, credentials, tokens, or cookies.
- Lists use bounded limits and stable cursors. Inputs are strict and unknown filters are rejected.

## Close gate

P6 closes only after hosted evidence proves all four calculations and weights, zero-denominator exclusion, limited/no-data labels, historical attribution, no student-score dependency, drill-down evidence, reports, audited safe export, responsible-only and cross-workspace isolation, immutable snapshots/export records, exact cleanup, clean migrations, CI, build, smoke, and Vercel health/readiness.
