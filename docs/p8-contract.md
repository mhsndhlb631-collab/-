# P8 production readiness and Pilot contract

**Status: frozen at P8 start. P0–P7 behavior remains authoritative.**

P8 proves that the existing product can be operated safely. It does not add a new product phase or relax any earlier assertion.

## Closure gates

1. **Environment isolation:** Local, Staging, and Production use distinct configuration and data targets. Preview must never connect to Production.
2. **Security:** authentication, same-origin mutation protection, role/workspace isolation, private DTOs, safe errors, cookies, RLS, and response headers pass targeted tests. An independent reviewer records any residual risk.
3. **Reference load:** a 200-student, 10-mentor, 12-week fixture supports 20 simultaneous authenticated users. All requests succeed and operational read P95 is below 1,000 ms. Cold-start latency is reported separately.
4. **Recovery:** a backup or equivalent logical recovery artifact is restored into an isolated target, migrations/checksums are verified, and a canary read/write succeeds. Production is never used as the restore target. RPO is at most 24 hours and measured RTO is at most 4 hours.
5. **Monitoring:** `/health` and `/ready` are probed at least hourly; a failed run is visible in GitHub Actions. Vercel logs correlate failures by safe `request_id`.
6. **Operations:** deploy, rollback, incident response, recovery, and secret rotation runbooks are executable by an operator who did not write the code.
7. **User journeys:** hosted acceptance for P0–P7 and the RESPONSIBLE, MENTOR, and STUDENT journeys passes without data leakage; exact fixtures are removed.
8. **Pilot:** fourteen consecutive calendar days are recorded with no unresolved critical incident, data loss, privacy leak, or blocking workflow failure. Start and end timestamps, daily evidence, incidents, and exit decision are preserved.

P8 may be marked `READINESS COMPLETE / PILOT ACTIVE` after gates 1–7 pass. It is `CLOSED` only after gate 8 has elapsed and passed; elapsed time cannot be simulated.

## Safe evidence

Evidence is written under ignored `output/p8/`. It may contain timestamps, status codes, latency percentiles, counts, safe application error codes, and request IDs. It must never contain passwords, tokens, cookies, connection strings, secret headers, raw names, email addresses, or personal data.
