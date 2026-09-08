import type { NextResponse } from "next/server";

export function setSessionCookies(
  response: NextResponse,
  input: { accessToken: string; refreshToken: string; hosted: boolean },
) {
  const prefix = input.hosted ? "__Host-" : "";
  const common = {
    httpOnly: true,
    secure: input.hosted,
    sameSite: "lax" as const,
    path: "/",
  };
  response.cookies.set(`${prefix}tarbiyah-access`, input.accessToken, {
    ...common,
    maxAge: 60 * 60,
  });
  response.cookies.set(`${prefix}tarbiyah-refresh`, input.refreshToken, {
    ...common,
    maxAge: 30 * 24 * 60 * 60,
  });
}
