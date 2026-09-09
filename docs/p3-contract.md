# P3 contract — tracking and progression

**Status: frozen before P3 implementation.** P0 identity/security, P1 plan ownership, and P2 historical-scope rules remain authoritative.

## Scope

P3 adds typed tracking definitions and schedules to a program plan, copies them into a cohort plan, derives daily and weekly entitlements, accepts student, mentor, and paper-transcribed entries, supports atomic mentor batches, and preserves versioned review/correction history. It also introduces the first student tracking surface.

## Decisions

- Definitions belong to a plan and are mutable only while that plan is `DRAFT`. Cohort creation copies definitions and schedules; live operation never reads the template plan.
- Supported values are boolean, count, percent, score, duration, number, enum, and short text. Exactly one JSON scalar of the declared type is accepted and configured minimum, maximum, and enum options are enforced server-side and in PostgreSQL.
- A schedule is daily or weekly, has an inclusive start week, optional inclusive end week, allowed weekdays, and an optional due time. Entitlements derive from the cohort start and workspace timezone; missing entries are never materialized or silently converted to zero.
- The stable entitlement key is enrollment + copied definition + period start + period end. A single current entry exists for that key.
- Sources are `STUDENT`, `MENTOR`, and `PAPER_TRANSCRIBED`. The definition explicitly allows sources. Students may write only their own `STUDENT` entry. Mentors may write only assigned students and mentor/paper sources. RESPONSIBLE may operate across the workspace while preserving the actual source and actor.
- Paper transcription records the represented period and occurrence time. Weekly summaries are accepted only for weekly definitions that explicitly allow them; they never fabricate daily completion.
- Every semantic entry change creates an immutable revision. Updating a reviewed entry increments the entry version and returns it to `PENDING` when review is required.
- A review names the exact entry version and is immutable. A stale review or stale row version returns `VERSION_CONFLICT`. Decisions are `VERIFIED` or `NEEDS_CORRECTION`.
- Exemption is an explicit entry state with no value and a reason; students cannot exempt themselves.
- Single and batch writes are transactional, idempotent, limited to 200 rows, audited, and all-or-nothing.
- RLS protects definitions, schedules, current entries, revisions, and reviews. Public Data API roles receive no table privileges.

## Close gate

P3 closes only after all four paths pass against real hosted infrastructure: student self-entry, scoped mentor entry, paper transcription, and version-specific review/correction. Acceptance must also prove correct daily/weekly entitlements, copied-plan independence, atomic batch rejection, stale-version rejection, cross-workspace and out-of-scope denial, immutable history, clean fixture removal, CI, production build, artifact smoke, and Vercel health/readiness.
