# Two-week Pilot runbook

## Entry

- Readiness gates 1–7 in `docs/p8-contract.md` pass.
- Production and Staging are isolated and Preview cannot use Production data.
- Restore drill, secret rotation, load test, security review, and all user journeys pass.
- Pilot owner, support contact, participating workspace, and start/end timestamps are recorded without personal data.

## Daily record

Record date, `/health` and `/ready` state, core RESPONSIBLE/MENTOR/STUDENT journey state, 5xx count, open critical/high incidents, backup age, and operator initials. Link safe request IDs for failures. Keep personal data and credentials out of the record.

## Exit

Fourteen consecutive days must complete with no unresolved critical incident, privacy leak, data loss, or blocking core journey. All high incidents need a verified fix and documented effect on the day count. Close P8 only after an explicit exit review confirms every contract gate with stored evidence.
