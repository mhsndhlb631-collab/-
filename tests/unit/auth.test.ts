import { describe, expect, it } from "vitest";
import {
  assertSession,
  canReadStudent,
  studentIdentityDto,
  type Account,
} from "../../src/domain/auth";
const now = new Date("2026-09-08T12:00:00Z");
const before = new Date("2026-09-08T11:00:00Z");
const account: Account = {
  id: "a",
  workspaceId: "w",
  personId: "p",
  role: "STUDENT",
  status: "ACTIVE",
  authUserId: "u",
  revokedBefore: null,
  mustChangePassword: false,
  temporaryPasswordExpiresAt: null,
};
const session = { userId: "u", createdAt: before };
describe("local auth policy (not real Supabase proof)", () => {
  it("accepts a linked active account", () =>
    expect(() => assertSession(account, session, now)).not.toThrow());
  it.each(["PROVISIONING", "CREDENTIAL_UPDATE", "DISABLED"] as const)(
    "blocks %s",
    (status) => {
      expect(() =>
        assertSession({ ...account, status }, session, now),
      ).toThrow();
    },
  );
  it("rejects mismatched owner", () =>
    expect(() =>
      assertSession(account, { ...session, userId: "other" }, now),
    ).toThrow());
  it("rejects an unlinked identity", () =>
    expect(() =>
      assertSession({ ...account, authUserId: null }, session, now),
    ).toThrow());
  it.each([before, now])(
    "rejects original session at or before cutoff %s",
    (revokedBefore) => {
      expect(() =>
        assertSession({ ...account, revokedBefore }, session, now),
      ).toThrow("انتهت صلاحية");
    },
  );
  it("accepts a new original session after cutoff", () => {
    expect(() =>
      assertSession(
        { ...account, revokedBefore: before },
        { ...session, createdAt: now },
        now,
      ),
    ).not.toThrow();
  });
  it("re-enabling does not revive previous sessions", () => {
    expect(() =>
      assertSession(
        { ...account, status: "ACTIVE", revokedBefore: now },
        session,
        now,
      ),
    ).toThrow();
  });
  it("forces password change without allowing domain data", () => {
    const temporary = {
      ...account,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(now.getTime() + 1000),
    };
    expect(() => assertSession(temporary, session, now)).toThrow("يلزم تغيير");
    expect(() =>
      assertSession(temporary, session, now, "change-password"),
    ).not.toThrow();
  });
  it("rejects an expired temporary credential even for password change", () => {
    expect(() =>
      assertSession(
        {
          ...account,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: now,
        },
        session,
        now,
        "change-password",
      ),
    ).toThrow();
  });
});
describe("scope and safe identity DTO", () => {
  it.each(["RESPONSIBLE", "MENTOR", "STUDENT"] as const)(
    "isolates workspace for %s",
    (role) => {
      expect(
        canReadStudent(
          { ...account, role },
          { workspaceId: "other", personId: "p" },
          true,
        ),
      ).toBe(false);
    },
  );
  it("lets RESPONSIBLE act across own workspace", () =>
    expect(
      canReadStudent(
        { ...account, role: "RESPONSIBLE" },
        { workspaceId: "w", personId: "other" },
        false,
      ),
    ).toBe(true));
  it("requires MENTOR assignment", () => {
    expect(
      canReadStudent(
        { ...account, role: "MENTOR" },
        { workspaceId: "w", personId: "other" },
        false,
      ),
    ).toBe(false);
    expect(
      canReadStudent(
        { ...account, role: "MENTOR" },
        { workspaceId: "w", personId: "other" },
        true,
      ),
    ).toBe(true);
  });
  it("resolves STUDENT only to self", () => {
    expect(
      canReadStudent(account, { workspaceId: "w", personId: "p" }, false),
    ).toBe(true);
    expect(
      canReadStudent(account, { workspaceId: "w", personId: "other" }, true),
    ).toBe(false);
  });
  it("projects a strict allowlist, excluding internal fields and synthetic email", () => {
    const row = {
      id: "s",
      displayName: "طالب",
      internal_notes: "private",
      email: "internal@secret.test",
      role: "RESPONSIBLE",
    };
    expect(studentIdentityDto(row)).toEqual({ id: "s", display_name: "طالب" });
  });
});
