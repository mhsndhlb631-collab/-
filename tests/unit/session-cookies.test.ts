import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { setSessionCookies } from "../../src/server/session-cookies";

describe("session cookies", () => {
  it("uses hosted __Host cookies and keeps tokens out of the body", async () => {
    const response = NextResponse.json({ next: "APP" });
    setSessionCookies(response, {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      hosted: true,
    });
    expect(await response.text()).not.toMatch(/access-secret|refresh-secret/);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/^__Host-tarbiyah-/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=lax");
      expect(cookie).toContain("Path=/");
    }
  });
});
