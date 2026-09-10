# P5 contract — attention, actions, followups, and cases

**Status: frozen before P5 implementation.** P0–P4.1 identity, historical scope, privacy, concurrency, audit, and automatic weekly-finalization boundaries remain authoritative.

## Scope

P5 implements deterministic attention evaluation, owned attention workflow, due actions with outcome verification, occurred followups with immutable correction history, manually opened cases with events and escalation, and an internal mentor/responsible workspace. It does not implement mentor scoring, responsible dashboards, reports, exports, or P6.

## Decisions

- Attention states are `OPEN / IN_PROGRESS / SNOOZED / RESOLVED / DISMISSED`; an active rule/evidence key is unique.
- Action states are `OPEN / IN_PROGRESS / DONE_PENDING_VERIFICATION / VERIFIED / CANCELLED`. Completion is not verification.
- Followup is an event that already occurred. A future commitment is an Action. Correction creates an immutable revision; cancellation is explicit and audited.
- Case states are `OPEN / MONITORING / RESOLVED / ARCHIVED`. Cases are opened manually, keep immutable events, and require verified outcome plus explanation before resolution.
- V1 evaluates: two consecutive unexcused absences, 14 days without qualified followup, new enrollment without check-in after 3 days, session overdue 24 hours, overdue exam/review, and overdue/missing next case action.
- The effective mentor at the obligation time owns attribution. Reassignment never transfers earlier lateness silently.
- RESPONSIBLE may perform mentor work inside the workspace while audit preserves the actual actor. STUDENT receives no P5 internal resource.
- Commands are strict, transactional, idempotent, row-version checked, audited, and protected with forced RLS.

## Close gate

P5 closes only after a hosted path proves rule evaluation without duplicates, claim/snooze/resolve/dismiss, action start/complete/verify, an occurred followup and immutable correction, manually opened/escalated/resolved case with verified outcome, responsibility attribution, stale-version rejection, student/cross-workspace denial, atomic audit, exact cleanup, clean migrations, CI, build, smoke, and Vercel health/readiness.
