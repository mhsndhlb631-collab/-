import { describe, expect, it } from "vitest";
import {
  UsernamePasswordLogin,
  rateBucket,
  type LoginAccountLookup,
  type LoginRateLimiter,
  type PasswordAuthGateway,
  type SessionAcceptance,
} from "../../src/application/login-adapter";

const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secret = "s".repeat(32);
function harness(
  options: {
    account?: "missing" | "disabled";
    rate?: boolean;
    authFails?: boolean;
    sessionFails?: boolean;
    mismatched?: boolean;
    mustChange?: boolean;
  } = {},
) {
  const observed: string[] = [];
  const accounts: LoginAccountLookup = {
    async byNormalizedLoginName(name) {
      observed.push(`lookup:${name}`);
      if (options.account === "missing") return null;
      return {
        id: uuid,
        authUserId: "provider-user",
        status: options.account === "disabled" ? "DISABLED" : "ACTIVE",
      };
    },
  };
  const limiter: LoginRateLimiter = {
    async reserve(bucket) {
      observed.push(`bucket:${bucket}`);
      return { allowed: options.rate !== false, retryAfterSeconds: 10 };
    },
  };
  const auth: PasswordAuthGateway = {
    async signIn(input) {
      observed.push(`email:${input.email}`);
      if (options.authFails)
        throw new Error("provider user and email must stay private");
      return { accessToken: "access", refreshToken: "refresh" };
    },
  };
  const sessions: SessionAcceptance = {
    async accept() {
      observed.push("accept");
      if (options.sessionFails) throw new Error("internal session detail");
      return {
        accountId: options.mismatched ? "other" : uuid,
        mustChangePassword: !!options.mustChange,
      };
    },
  };
  return {
    login: new UsernamePasswordLogin(
      accounts,
      limiter,
      auth,
      sessions,
      "auth.example.test",
      secret,
    ),
    observed,
  };
}
describe("username/password login adapter", () => {
  it("normalizes, rate-limits twice, derives private technical email and accepts session", async () => {
    const h = harness();
    const result = await h.login.execute({
      loginName: "طالب١٢٣",
      password: "secret",
      networkKey: "trusted-proxy:203.0.113.0/24",
    });
    expect(result).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      next: "APP",
    });
    expect(h.observed).toContain("lookup:طالب123");
    expect(h.observed).toContain(`email:${uuid}@auth.example.test`);
    expect(h.observed.filter((x) => x.startsWith("bucket:"))).toHaveLength(2);
  });
  it("routes a temporary login only to password change", async () => {
    const result = await harness({ mustChange: true }).login.execute({
      loginName: "student",
      password: "secret",
      networkKey: "net",
    });
    expect(result.next).toBe("CHANGE_PASSWORD");
  });
  it.each([
    [{ loginName: "bad name", password: "x", networkKey: "net" }, {}],
    [{ loginName: "student", password: "", networkKey: "net" }, {}],
    [
      { loginName: "student", password: "x", networkKey: "net" },
      { account: "missing" as const },
    ],
    [
      { loginName: "student", password: "x", networkKey: "net" },
      { account: "disabled" as const },
    ],
    [
      { loginName: "student", password: "x", networkKey: "net" },
      { authFails: true },
    ],
  ])("returns the same public credential error", async (input, options) => {
    await expect(harness(options).login.execute(input)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });
  it("rejects before lookup when a distributed bucket denies", async () => {
    const h = harness({ rate: false });
    await expect(
      h.login.execute({
        loginName: "student",
        password: "x",
        networkKey: "net",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(h.observed.some((x) => x.startsWith("lookup:"))).toBe(false);
  });
  it("does not convert a failed session acceptance into a successful login", async () => {
    await expect(
      harness({ sessionFails: true }).login.execute({
        loginName: "student",
        password: "x",
        networkKey: "net",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("rejects a session resolved to another account", async () => {
    await expect(
      harness({ mismatched: true }).login.execute({
        loginName: "student",
        password: "x",
        networkKey: "net",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
describe("rate bucket privacy", () => {
  it("is deterministic, domain-separated and contains no source value", () => {
    const a = rateBucket(secret, "login-name", "student");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(rateBucket(secret, "login-name", "student"));
    expect(a).not.toBe(rateBucket(secret, "network", "student"));
    expect(a).not.toContain("student");
  });
  it("requires a strong secret and a nonempty value", () => {
    expect(() => rateBucket("weak", "login-name", "student")).toThrow();
    expect(() => rateBucket(secret, "network", "")).toThrow();
  });
});
