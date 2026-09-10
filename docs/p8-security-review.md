# P8 targeted security review

**Internal review complete; independent external review remains a closure gate.**

## Passed evidence

- Hosted requests without authentication cannot read private routes.
- State-changing login requests from a different origin are rejected.
- Malformed JSON receives a stable validation error without stack traces, database URLs, tokens, secret-key labels, or provider detail.
- GET cannot invoke logout mutation.
- Production responses include frame denial, MIME sniffing denial, same-origin referrer policy, and disabled camera, microphone, geolocation, and payment permissions.
- The full production dependency audit reports zero known vulnerabilities at moderate severity or above.
- Tracked files contain no real credential values. The only credential-shaped matches are intentionally synthetic test fixtures.
- P0 and P7 hosted acceptance prove revocation, disabled-account behavior, workspace isolation, role isolation, private DTOs, and secure cookie behavior.

## Open findings

1. **High before Pilot — legacy HS256 signing.** Current user access tokens require a network call to Supabase Auth for every `getClaims()` verification. Migrate the legacy JWT secret to the signing-key system, rotate to an asymmetric key, issue a fresh test session, and re-run all auth and load gates. Keep the previous key trusted for at least the configured access-token lifetime plus 15 minutes before revocation.
2. **Critical before Pilot — previously displayed secrets.** Rotate every value shown during setup, update local and Production server-only storage, redeploy, verify login/revocation/readiness, then remove the previous values.
3. **High before Pilot — independent review.** A reviewer who did not implement the system must repeat the threat-focused checks for auth bypass, IDOR/workspace escape, stored data exposure, CSRF, injection, session revocation, and audit tampering, and record residual risk.

No open finding may be reclassified as passed without new evidence.
