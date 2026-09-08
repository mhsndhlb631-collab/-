import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../domain/errors";
import { normalizeUsername } from "../domain/username";
import type { Account, Role } from "../domain/auth";

export type MutableAccount = Account & {
  normalizedLoginName: string;
  disabledAt: Date | null;
  rowVersion: number;
};

export interface Actor {
  accountId: string;
  workspaceId: string;
  role: Role;
  authenticatedAt: Date;
}

export interface AccountRepository {
  reserveProvision(input: {
    actor: Actor;
    personId: string;
    normalizedLoginName: string;
    role: Role;
    requestHash: string;
    idempotencyKey: string;
  }): Promise<{ account: MutableAccount; replay: boolean }>;
  findProvisioning(accountId: string): Promise<MutableAccount>;
  linkProvisioning(input: {
    accountId: string;
    authUserId: string;
  }): Promise<MutableAccount>;
  completeProvision(input: {
    accountId: string;
    temporaryPasswordExpiresAt: Date;
  }): Promise<MutableAccount>;
  beginCredentialUpdate(input: {
    actor: Actor;
    accountId: string;
    expectedVersion: number;
    requestHash: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<{ account: MutableAccount; replay: boolean }>;
  completeCredentialUpdate(input: {
    accountId: string;
    expectedVersion: number;
    temporaryPasswordExpiresAt: Date;
    now: Date;
  }): Promise<MutableAccount>;
  transition(input: {
    actor: Actor;
    accountId: string;
    expectedVersion: number;
    command: "disable" | "enable" | "revoke";
    now: Date;
  }): Promise<MutableAccount>;
}

export interface AuthAdministration {
  /** Must create a disabled/banned identity or recover the deterministic existing identity. */
  stageUser(input: {
    technicalEmail: string;
    temporaryPassword: string;
  }): Promise<{ userId: string }>;
  activateUser(userId: string): Promise<void>;
  updatePassword(userId: string, temporaryPassword: string): Promise<void>;
}

export interface PasswordGenerator {
  temporary(): string;
}

export class RandomPasswordGenerator implements PasswordGenerator {
  temporary() {
    return randomBytes(24).toString("base64url");
  }
}

function assertResponsible(actor: Actor, workspaceId?: string) {
  if (
    actor.role !== "RESPONSIBLE" ||
    (workspaceId && actor.workspaceId !== workspaceId)
  ) {
    throw new AppError("FORBIDDEN");
  }
}

function hashRequest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class AccountCommands {
  constructor(
    private readonly repository: AccountRepository,
    private readonly auth: AuthAdministration,
    private readonly passwords: PasswordGenerator,
    private readonly internalEmailDomain: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async provision(input: {
    actor: Actor;
    personId: string;
    loginName: unknown;
    role: Role;
    idempotencyKey: string;
  }) {
    assertResponsible(input.actor);
    if (input.role === "RESPONSIBLE" && input.actor.role !== "RESPONSIBLE")
      throw new AppError("FORBIDDEN");
    const normalizedLoginName = normalizeUsername(input.loginName);
    const requestHash = hashRequest({
      personId: input.personId,
      normalizedLoginName,
      role: input.role,
    });
    const reservation = await this.repository.reserveProvision({
      actor: input.actor,
      personId: input.personId,
      normalizedLoginName,
      role: input.role,
      requestHash,
      idempotencyKey: input.idempotencyKey,
    });
    if (reservation.account.status !== "PROVISIONING") {
      // Temporary credentials are intentionally never replayed.
      return {
        accountId: reservation.account.id,
        status: reservation.account.status,
        temporaryPassword: null,
      };
    }
    const temporaryPassword = this.passwords.temporary();
    const technicalEmail = `${reservation.account.id}@${this.internalEmailDomain}`;
    let provisioning = reservation.account;
    if (!provisioning.authUserId) {
      let staged: { userId: string };
      try {
        staged = await this.auth.stageUser({
          technicalEmail,
          temporaryPassword,
        });
      } catch {
        // Reservation stays PROVISIONING and therefore has no domain access.
        throw new AppError("DEPENDENCY_UNAVAILABLE");
      }
      provisioning = await this.repository.linkProvisioning({
        accountId: provisioning.id,
        authUserId: staged.userId,
      });
    } else {
      // A prior attempt linked the disabled identity but did not finish. Rotate to the
      // newly returned one-time secret before activation; no stale secret is replayed.
      try {
        await this.auth.updatePassword(
          provisioning.authUserId,
          temporaryPassword,
        );
      } catch {
        throw new AppError("DEPENDENCY_UNAVAILABLE");
      }
    }
    const expiresAt = new Date(this.clock().getTime() + 24 * 60 * 60 * 1000);
    try {
      await this.auth.activateUser(provisioning.authUserId!);
    } catch {
      // A linked provider-disabled identity and local PROVISIONING state are both deny-by-default.
      throw new AppError("DEPENDENCY_UNAVAILABLE");
    }
    const account = await this.repository.completeProvision({
      accountId: provisioning.id,
      temporaryPasswordExpiresAt: expiresAt,
    });
    return { accountId: account.id, status: account.status, temporaryPassword };
  }

  async resetPassword(input: {
    actor: Actor;
    accountId: string;
    workspaceId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }) {
    const now = this.clock();
    assertResponsible(input.actor, input.workspaceId);
    if (now.getTime() - input.actor.authenticatedAt.getTime() > 5 * 60 * 1000)
      throw new AppError("FORBIDDEN");
    const requestHash = hashRequest({
      accountId: input.accountId,
      expectedVersion: input.expectedVersion,
    });
    const begun = await this.repository.beginCredentialUpdate({
      ...input,
      requestHash,
      now,
    });
    if (begun.replay && begun.account.status === "ACTIVE") {
      return {
        accountId: begun.account.id,
        status: begun.account.status,
        temporaryPassword: null,
      };
    }
    if (begun.account.status !== "CREDENTIAL_UPDATE")
      throw new AppError("INVALID_STATE_TRANSITION");
    if (!begun.account.authUserId)
      throw new AppError("INVALID_STATE_TRANSITION");
    const temporaryPassword = this.passwords.temporary();
    try {
      await this.auth.updatePassword(
        begun.account.authUserId,
        temporaryPassword,
      );
    } catch {
      // CREDENTIAL_UPDATE remains blocked until explicit retry/reconciliation.
      throw new AppError("DEPENDENCY_UNAVAILABLE");
    }
    const account = await this.repository.completeCredentialUpdate({
      accountId: begun.account.id,
      expectedVersion: begun.account.rowVersion,
      temporaryPasswordExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      now,
    });
    return { accountId: account.id, status: account.status, temporaryPassword };
  }

  async disable(
    input: Omit<
      Parameters<AccountRepository["transition"]>[0],
      "command" | "now"
    >,
  ) {
    assertResponsible(input.actor);
    return this.repository.transition({
      ...input,
      command: "disable",
      now: this.clock(),
    });
  }

  async enable(
    input: Omit<
      Parameters<AccountRepository["transition"]>[0],
      "command" | "now"
    >,
  ) {
    assertResponsible(input.actor);
    return this.repository.transition({
      ...input,
      command: "enable",
      now: this.clock(),
    });
  }

  async revoke(
    input: Omit<
      Parameters<AccountRepository["transition"]>[0],
      "command" | "now"
    >,
  ) {
    assertResponsible(input.actor);
    return this.repository.transition({
      ...input,
      command: "revoke",
      now: this.clock(),
    });
  }
}
