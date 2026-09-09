# P4 contract — learning and student week

**Status: frozen before P4 implementation.** P0 identity/security, P1 copied-plan ownership, P2 historical session scope, and P3 versioned tracking remain authoritative.

## Scope

P4 adds published learning content, assignments and versioned submissions, exams and explicitly published results, student self-review, and a weekly student summary that exposes coverage and evidence before any score. It closes with an immutable approval snapshot and a correction path that creates a new approval revision.

## Decisions

- Content, assignment, and exam definitions belong to a plan week. Cohort creation copies them into the cohort plan; live operation never reads template definitions.
- Students see only published content and published feedback/results for their own active enrollment. Internal notes and unpublished scoring material never share a response field with student-visible text.
- One current assignment submission exists per enrollment and copied definition. Each semantic edit increments its version and writes an immutable revision. Mentor review records score, internal notes, and separately controlled student feedback.
- One current exam result exists per enrollment and copied definition. Mentor entry remains private until explicit publication. Corrections preserve the earlier version and publication evidence.
- A student self-review is keyed by enrollment and plan week, contains a bounded rating and reflection, and remains versioned.
- The weekly summary key is enrollment + plan week. Its sources are sessions/attendance, tracking, assignments, exams, and self-review. Missing facts remain missing; they do not silently become zero.
- Coverage is completed applicable facts divided by applicable expected facts. Exempt and non-applicable facts stay outside the score denominator.
- Numeric evidence is normalized against declared maximum/target and combined using the copied plan weights. The summary stores numerator, denominator, coverage, component evidence, and scoring-rule version.
- Lifecycle is `OPEN -> READY -> APPROVED`. Approval locks an immutable snapshot. A correction requires a reason, recomputes current evidence, increments the approval revision, and preserves every previous snapshot.
- All writes are strict, idempotent where applicable, concurrency checked with `row_version`, audited in the same transaction, and protected by forced RLS.

## Close gate

P4 closes only when a real hosted week proves published content, student submission, mentor assignment review, private-then-published exam score, student self-review, deterministic coverage/score, approval, source correction, a new approval revision, stale-version rejection, cross-scope denial, immutable history, exact fixture cleanup, CI, production build, artifact smoke, and Vercel health/readiness.
