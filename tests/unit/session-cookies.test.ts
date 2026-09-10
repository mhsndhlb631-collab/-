import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  clearSessionCookies,
  readSessionCookies,
  setSessionCookies,
} from "../../src/server/session-cookies";

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
  it("reads the selected cookie namespace and expires both cookies on logout", () => {
    const request = new Request("https://app.test", {
      headers: {
        cookie:
          "__Host-tarbiyah-access=access; __Host-tarbiyah-refresh=refresh",
      },
    });
    expect(readSessionCookies(request, true)).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
    const response = NextResponse.json({ next: "LOGIN" });
    clearSessionCookies(response, true);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/^__Host-tarbiyah-/);
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
    }
  });
});
