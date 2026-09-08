import { describe, expect, it } from "vitest";
import { loginBody, trustedNetworkKey } from "../../src/server/login-http";

describe("login HTTP input", () => {
  it("accepts only the two public fields", () => {
    expect(loginBody({ login_name: "student", password: "secret" })).toEqual({
      loginName: "student",
      password: "secret",
    });
    expect(() =>
      loginBody({ login_name: "x", password: "y", email: "leak" }),
    ).toThrow();
  });
  it("trusts Vercel forwarding only in hosted mode", () => {
    const request = new Request("http://localhost", {
      headers: { "x-vercel-forwarded-for": "203.0.113.1" },
    });
    expect(trustedNetworkKey(request, false)).toBe("local-development");
    expect(trustedNetworkKey(request, true)).toBe("203.0.113.1");
    expect(() =>
      trustedNetworkKey(new Request("https://app.test"), true),
    ).toThrow();
  });
});
