# P7 contract — complete role journeys

**Status: frozen before P7 implementation.** P0–P6 domain rules, historical attribution, privacy, immutable records, and report calculations remain authoritative.

## Scope

P7 completes the daily product journeys for RESPONSIBLE, MENTOR, and STUDENT. It adds self identity, secure logout, first-login and voluntary password change, unified today/program/progress views, role-specific navigation, complete loading/empty/error/retry states, mobile RTL layout, keyboard focus, semantic landmarks, and accessible form/status feedback.

P7 does not change program, session, tracking, learning, follow-up, performance, or report rules. It does not add P8 load, penetration, backup/restore, monitoring, or pilot gates.

## Role journeys

- RESPONSIBLE lands on team status, opens mentor evidence and reports, and reaches program setup and operational work without seeing student-only controls.
- MENTOR lands on assigned work, opens sessions, tracking, learning, follow-up, actions, and cases within effective scope, and never receives responsible performance/report resources.
- STUDENT lands on personal due work, moves between program, tracking, learning, and progress, and never receives internal notes, cases, attention, mentor performance, or other students.
- Every signed-in role can read its own safe identity, change its own password after verifying the current password, and log out. Password change revokes the current and earlier sessions and requires a fresh login.

## Interface and access

- Arabic RTL is authoritative. Layout supports 320 CSS-pixel width without page-level horizontal overflow.
- Navigation, main content, headings, forms, status messages, and buttons use semantic labels and keyboard-visible focus.
- Loading, empty, success, validation, authorization, session expiry, and retry states use clear Arabic text and never expose technical or private details.
- The server shapes every DTO by authenticated role and workspace; UI hiding is only an additional presentation boundary.

## Close gate

P7 closes only after hosted acceptance proves identity, role-specific today/program/progress DTOs, all three role boundaries, first-login password change, old-session rejection, fresh-login success, logout cookie clearing, cross-workspace isolation, safe fields, page semantics, 320px RTL layout checks, exact fixture cleanup, clean migration checksums, CI, build, smoke, and Vercel health/readiness.
