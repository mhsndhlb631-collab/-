# Frozen P0 auth, permissions and scope v1

## State transitions

| Command                   | From                                  | Safe local state before Auth call                                       | Success                                                               | Partial/uncertain failure                                                   |
| ------------------------- | ------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Provision existing person | no account                            | PROVISIONING; reserve global normalized name + operation ID             | ACTIVE, linked Auth ID, must_change_password, 24h expiry              | remain PROVISIONING; reconcile deterministic internal identity before retry |
| Admin reset               | ACTIVE or DISABLED, exact row_version | CREDENTIAL_UPDATE; revoke existing sessions and audit transition        | ACTIVE with new cutoff + temporary credential expiry; forced change   | remain CREDENTIAL_UPDATE, no domain access; explicit retry/reconciliation   |
| Change own password       | ACTIVE                                | CREDENTIAL_UPDATE after proving current password; revoke prior sessions | ACTIVE with new cutoff; clear forced change/expiry; require new login | remain blocked; administrative recovery is available                        |
| Disable                   | ACTIVE or CREDENTIAL_UPDATE           | same transaction                                                        | DISABLED + disabled_at + cutoff                                       | transaction rolls back                                                      |
| Enable                    | DISABLED                              | same transaction                                                        | ACTIVE; clear disabled_at; retain cutoff and credential restrictions  | transaction rolls back                                                      |
| Revoke sessions           | ACTIVE                                | same transaction                                                        | advance cutoff using database clock                                   | transaction rolls back                                                      |
| Require password change   | ACTIVE                                | same transaction                                                        | advance cutoff; must_change_password=true; bounded change window      | transaction rolls back                                                      |

DECISION: PROVISIONING cannot be enabled administratively. Incomplete Auth work cannot bypass reconciliation. An inactive/unlinked Auth identity must have no application access. Provisioning strategy must additionally demonstrate no active-but-unlinked Auth identity at interruption points; this is a release gate, not assumed solved by local state alone. A staged banned identity, linked before unban, is a candidate requiring real Auth testing.

Login uses only username/password. Global username lookup derives a technical email from account UUID and a domain owned by the operator. No internal email or provider user object reaches the client. Provider error text is never returned. Official Supabase SSR cookie integration must be evaluated for internal-email exposure before release; no browser Auth object or token response may leak the synthetic email. This is a specific privacy gate.

Supabase remains the sole token issuer and refresh manager. No application session table. Domain access requires verified signature/issuer/expiry, valid original session, linked active account, no forced password change, same workspace and proper scope. Original session creation at or before revoked_before is rejected. JWT iat is never a replacement for original session time.

Admin reset requires recent authentication (<=5 minutes), same-workspace RESPONSIBLE and an idempotency key. Retries never replay a temporary password. If delivery is lost, issue a new reset operation. Serialize account mutations with disable/revoke and preserve every successful local sensitive change with an atomic audit event.

## Permissions

| Capability                                  | RESPONSIBLE                           | MENTOR                           | STUDENT                     |
| ------------------------------------------- | ------------------------------------- | -------------------------------- | --------------------------- |
| Read own safe identity                      | yes                                   | yes                              | yes                         |
| Create/archive person and link account      | own workspace                         | no                               | no                          |
| Disable/enable/reset/revoke another account | own workspace, protected command      | no                               | no                          |
| Change own password/logout                  | yes                                   | yes                              | yes                         |
| Read minimal student foundation             | own workspace                         | currently assigned scope fixture | self derived from person_id |
| Read private fixture data                   | own workspace                         | assigned scope fixture           | never                       |
| Perform mentor-level fixture operation      | own workspace with actual actor audit | assigned scope                   | no                          |
| Audit                                       | own workspace allowed fields          | no                               | no                          |

DECISION: A role is read from login_accounts on the server and checked again inside sensitive DB commands. The historical primary mentor is selected by effective-time assignment, not overwritten by the current actor. Ended assignments remove current scope. Sensitive handoff access requires explicit future design; no implicit expansion.

## Username normalization

NFC -> trim outside whitespace -> Arabic/Persian digits to ASCII -> Latin ASCII lowercase. Accept exactly 3..32 Unicode code points from ASCII a-z, 0-9, underscore, and Arabic letters U+0621..U+063A / U+0641..U+064A. Reject Arabic tatweel U+0640, combining marks, internal spaces, invisible/directional controls, presentation forms and all other characters. Do not fold hamza, ta marbuta, alif maqsura or ya. This exact code-point set resolves the original phrase 'basic Arabic letters'.

Validate normalized values in both command service and DB constraint. Permanent uniqueness applies across workspaces and disabled accounts. Usernames are immutable in V1. Login errors are generic and do not reveal existence.

## Session spike gate

Run on a dedicated real Supabase project, using an existing disposable linked account and runtime DB role:

1. normal sign-in and verified original-session lookup succeeds;
2. refresh same session (prove same session_id);
3. set linked account revoked_before with DB time;
4. the refreshed token must still fail application acceptance;
5. a new sign-in must have a different session_id, later original created_at and succeed.

Also refresh the old session AFTER revocation where the provider allows it, and prove its token remains rejected. Save sanitized boolean assertions only, no token/email/password. Verify runtime identity, pool context and grants separately. The spike does not prove all account recovery or RLS requirements.

OPEN QUESTION: Project access is required to test these transitions; compatibility is not inferred from mocks or documentation.
