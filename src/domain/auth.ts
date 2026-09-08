import { AppError } from "./errors";

export type Role = "RESPONSIBLE" | "MENTOR" | "STUDENT";
export type AccountStatus =
  "PROVISIONING" | "ACTIVE" | "CREDENTIAL_UPDATE" | "DISABLED";
export interface Account {
  id: string;
  workspaceId: string;
  personId: string;
  role: Role;
  status: AccountStatus;
  authUserId: string | null;
  revokedBefore: Date | null;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt: Date | null;
}
/** Input session must be signature/issuer/expiry verified and loaded through the proven accessor.
 * This policy alone is NOT a token verifier; no public auth route uses it before the real spike passes.
 */
export function assertSession(
  account: Account,
  session: { userId: string; createdAt: Date },
  now: Date,
  purpose: "domain" | "change-password" = "domain",
) {
  if (
    !account.authUserId ||
    account.authUserId !== session.userId ||
    !Number.isFinite(session.createdAt.getTime())
  )
    throw new AppError("UNAUTHENTICATED");
  if (account.status === "DISABLED") throw new AppError("ACCOUNT_DISABLED");
  if (account.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED");
  if (account.revokedBefore && session.createdAt <= account.revokedBefore)
    throw new AppError("SESSION_REVOKED");
  if (account.mustChangePassword) {
    if (
      !account.temporaryPasswordExpiresAt ||
      account.temporaryPasswordExpiresAt <= now
    )
      throw new AppError("INVALID_CREDENTIALS");
    if (purpose !== "change-password")
      throw new AppError("PASSWORD_CHANGE_REQUIRED");
  }
}

export function canReadStudent(
  actor: Pick<Account, "workspaceId" | "personId" | "role">,
  student: { workspaceId: string; personId: string },
  assigned: boolean,
) {
  if (actor.workspaceId !== student.workspaceId) return false;
  if (actor.role === "RESPONSIBLE") return true;
  if (actor.role === "MENTOR") return assigned;
  return actor.personId === student.personId;
}

export function studentIdentityDto(student: {
  id: string;
  displayName: string;
}) {
  return { id: student.id, display_name: student.displayName };
}
