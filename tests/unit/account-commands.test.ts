import { describe, expect, it } from "vitest";
import {
  AccountCommands,
  type AccountRepository,
  type AuthAdministration,
  type MutableAccount,
} from "../../src/application/account-commands";

const now = new Date("2026-09-08T12:00:00Z");
const actor = {
  accountId: "admin",
  workspaceId: "w1",
  role: "RESPONSIBLE" as const,
  authenticatedAt: now,
};
const base: MutableAccount = {
  id: "account",
  workspaceId: "w1",
  personId: "person",
  normalizedLoginName: "طالب123",
  role: "STUDENT",
  status: "PROVISIONING",
  authUserId: null,
  revokedBefore: null,
  mustChangePassword: true,
  temporaryPasswordExpiresAt: null,
  disabledAt: null,
  rowVersion: 1,
};

function harness(
  options: {
    stageFails?: boolean;
    activateFails?: boolean;
    updateFails?: boolean;
    resetReplayComplete?: boolean;
  } = {},
) {
  let account = { ...base };
  let reservedHash = "";
  const calls: string[] = [];
  const repository: AccountRepository = {
    async reserveProvision(input) {
      calls.push("reserve");
      if (reservedHash && reservedHash !== input.requestHash)
        throw Object.assign(new Error(), { code: "IDEMPOTENCY_CONFLICT" });
      reservedHash = input.requestHash;
      return {
        account: { ...account },
        replay: calls.filter((x) => x === "reserve").length > 1,
      };
    },
    async findProvisioning() {
      return { ...account };
    },
    async linkProvisioning(input) {
      calls.push("link");
      account = {
        ...account,
        authUserId: input.authUserId,
        rowVersion: account.rowVersion + 1,
      };
      return { ...account };
    },
    async completeProvision(input) {
      calls.push("complete-provision");
      account = {
        ...account,
        status: "ACTIVE",
        temporaryPasswordExpiresAt: input.temporaryPasswordExpiresAt,
        rowVersion: account.rowVersion + 1,
      };
      return { ...account };
    },
    async beginCredentialUpdate(input) {
      calls.push("begin-reset");
      if (options.resetReplayComplete)
        return { account: { ...account }, replay: true };
      if (input.expectedVersion !== account.rowVersion)
        throw Object.assign(new Error(), { code: "VERSION_CONFLICT" });
      account = {
        ...account,
        status: "CREDENTIAL_UPDATE",
        revokedBefore: input.now,
        rowVersion: account.rowVersion + 1,
      };
      return { account: { ...account }, replay: false };
    },
    async completeCredentialUpdate(input) {
      calls.push("complete-reset");
      account = {
        ...account,
        status: "ACTIVE",
        mustChangePassword: true,
        temporaryPasswordExpiresAt: input.temporaryPasswordExpiresAt,
        revokedBefore: input.now,
        rowVersion: account.rowVersion + 1,
      };
      return { ...account };
    },
    async transition(input) {
      calls.push(input.command);
      return { ...account };
    },
  };
  const auth: AuthAdministration = {
    async stageUser({ technicalEmail, temporaryPassword }) {
      calls.push(`stage:${technicalEmail}`);
      expect(temporaryPassword).toBe("one-time-secret");
      if (options.stageFails)
        throw new Error("provider details must not escape");
      return { userId: "auth-user" };
    },
    async activateUser() {
      calls.push("activate");
      if (options.activateFails) throw new Error("provider details");
    },
    async updatePassword() {
      calls.push("update-password");
      if (options.updateFails) throw new Error("provider details");
    },
  };
  const service = new AccountCommands(
    repository,
    auth,
    { temporary: () => "one-time-secret" },
    "auth.example.test",
    () => now,
  );
  return {
    service,
    calls,
    getAccount: () => account,
    setAccount: (value: MutableAccount) => {
      account = value;
    },
  };
}

describe("account command orchestration", () => {
  it("provisions onto an existing person and activates only after linking", async () => {
    const h = harness();
    const result = await h.service.provision({
      actor,
      personId: "person",
      loginName: "طالب١٢٣",
      role: "STUDENT",
      idempotencyKey: "key",
    });
    expect(result).toEqual({
      accountId: "account",
      status: "ACTIVE",
      temporaryPassword: "one-time-secret",
    });
    expect(h.calls).toEqual([
      "reserve",
      "stage:account@auth.example.test",
      "link",
      "activate",
      "complete-provision",
    ]);
  });
  it("keeps a provider failure blocked in PROVISIONING and hides provider details", async () => {
    const h = harness({ stageFails: true });
    await expect(
      h.service.provision({
        actor,
        personId: "person",
        loginName: "طالب123",
        role: "STUDENT",
        idempotencyKey: "key",
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(h.getAccount().status).toBe("PROVISIONING");
  });
  it("leaves activation failure safely linked and provisioning for reconciliation", async () => {
    const h = harness({ activateFails: true });
    await expect(
      h.service.provision({
        actor,
        personId: "person",
        loginName: "طالب123",
        role: "STUDENT",
        idempotencyKey: "key",
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(h.getAccount()).toMatchObject({
      status: "PROVISIONING",
      authUserId: "auth-user",
    });
    expect(h.calls.at(-1)).toBe("activate");
  });
  it("retries activation without creating a second Auth identity", async () => {
    const h = harness();
    h.setAccount({ ...base, authUserId: "auth-user" });
    const result = await h.service.provision({
      actor,
      personId: "person",
      loginName: "طالب123",
      role: "STUDENT",
      idempotencyKey: "key",
    });
    expect(result.status).toBe("ACTIVE");
    expect(h.calls).toEqual([
      "reserve",
      "update-password",
      "activate",
      "complete-provision",
    ]);
  });
  it("keeps linked provisioning blocked if rotating the retry credential fails", async () => {
    const h = harness({ updateFails: true });
    h.setAccount({ ...base, authUserId: "auth-user" });
    await expect(
      h.service.provision({
        actor,
        personId: "person",
        loginName: "طالب123",
        role: "STUDENT",
        idempotencyKey: "key",
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(h.getAccount().status).toBe("PROVISIONING");
    expect(h.calls).toEqual(["reserve", "update-password"]);
  });
  it("does not replay a temporary password after completed provisioning", async () => {
    const h = harness();
    await h.service.provision({
      actor,
      personId: "person",
      loginName: "طالب123",
      role: "STUDENT",
      idempotencyKey: "key",
    });
    const replay = await h.service.provision({
      actor,
      personId: "person",
      loginName: "طالب123",
      role: "STUDENT",
      idempotencyKey: "key",
    });
    expect(replay.temporaryPassword).toBeNull();
    expect(h.calls.filter((x) => x.startsWith("stage:"))).toHaveLength(1);
  });
  it("requires recent responsible authentication for reset", async () => {
    const h = harness();
    h.setAccount({ ...base, status: "ACTIVE", authUserId: "auth-user" });
    await expect(
      h.service.resetPassword({
        actor: { ...actor, authenticatedAt: new Date(now.getTime() - 301000) },
        accountId: "account",
        workspaceId: "w1",
        expectedVersion: 1,
        idempotencyKey: "key",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps failed password update in CREDENTIAL_UPDATE", async () => {
    const h = harness({ updateFails: true });
    h.setAccount({
      ...base,
      status: "ACTIVE",
      authUserId: "auth-user",
      mustChangePassword: false,
    });
    await expect(
      h.service.resetPassword({
        actor,
        accountId: "account",
        workspaceId: "w1",
        expectedVersion: 1,
        idempotencyKey: "key",
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(h.getAccount()).toMatchObject({
      status: "CREDENTIAL_UPDATE",
      revokedBefore: now,
    });
  });
  it("completes reset with forced change and one-time credential", async () => {
    const h = harness();
    h.setAccount({
      ...base,
      status: "ACTIVE",
      authUserId: "auth-user",
      mustChangePassword: false,
    });
    const result = await h.service.resetPassword({
      actor,
      accountId: "account",
      workspaceId: "w1",
      expectedVersion: 1,
      idempotencyKey: "key",
    });
    expect(result.temporaryPassword).toBe("one-time-secret");
    expect(h.getAccount()).toMatchObject({
      status: "ACTIVE",
      mustChangePassword: true,
      revokedBefore: now,
    });
  });
  it("does not rotate or replay a credential for an already completed reset", async () => {
    const h = harness({ resetReplayComplete: true });
    h.setAccount({
      ...base,
      status: "ACTIVE",
      authUserId: "auth-user",
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(now.getTime() + 86400000),
      rowVersion: 3,
    });
    const result = await h.service.resetPassword({
      actor,
      accountId: "account",
      workspaceId: "w1",
      expectedVersion: 1,
      idempotencyKey: "key",
    });
    expect(result).toEqual({
      accountId: "account",
      status: "ACTIVE",
      temporaryPassword: null,
    });
    expect(h.calls).toEqual(["begin-reset"]);
  });
  it.each(["MENTOR", "STUDENT"] as const)(
    "blocks %s from account administration",
    async (role) => {
      const h = harness();
      await expect(
        h.service.disable({
          actor: { ...actor, role },
          accountId: "account",
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
});
