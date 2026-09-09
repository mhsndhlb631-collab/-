# P2 contract — educational sessions

**Status: frozen before P2 implementation.** P0 identity/security and P1 plan/distribution boundaries remain authoritative.

## Scope

P2 implements plan session definitions and typed metrics, generated group occurrences, frozen rosters, attendance, partial metric recording, close validation, cancellation, and audited post-close correction. Tracking schedules, weekly summaries, attention, follow-up, assignments, and exams remain later stages.

## Decisions

- Template plan publication accepts session definitions attached to numbered weeks. Definitions and metric constraints are copied into the cohort plan and never read live from the template.
- Cohort creation generates one occurrence per copied definition and group. The unique definition/group pair makes retries unable to duplicate an occurrence.
- Occurrence time derives from cohort start, plan week number, relative day, local start time, workspace timezone, and duration.
- `PLANNED -> OPEN -> CLOSED`; `PLANNED` or `OPEN` may become `CANCELLED` only with a reason. Closed sessions never reopen.
- Opening locks the occurrence and freezes the active enrollment/group membership roster at the scheduled start. The primary mentor at that instant is frozen on the occurrence. Later enrollment or assignment changes do not rewrite history.
- Attendance is `PRESENT`, `LATE`, `EXCUSED_ABSENCE`, `UNEXCUSED_ABSENCE`, or initially `NOT_RECORDED`. Partial saves are valid while open.
- Required metrics apply only to attendance statuses declared by the definition. Missing required attendance or applicable metrics returns `INCOMPLETE_SESSION` and leaves the session open.
- The frozen primary mentor may operate the session. RESPONSIBLE may perform the same commands in the workspace; audit records the responsible actor without changing mentor attribution.
- Every save, open, close, cancel, and correction is transactional, idempotent, audited, and protected by a locked occurrence row. Record updates require `row_version`.
- A correction is the only mutation path after close. It requires a reason and stores immutable before/after snapshots plus the actor and request.
- RLS limits mentors to frozen/assigned groups and students to their own roster data. Direct Data API roles remain denied.

## Close gate

P2 closes only after a real hosted session can be generated, opened with a historical roster, partially saved, rejected as incomplete, completed, closed exactly once under retry/concurrency, and corrected with preserved history. A RESPONSIBLE delegation and MENTOR scope test, clean migrations, CI, build, artifact smoke, and Vercel acceptance are mandatory.
