import type { NextResponse } from "next/server";

function cookie(request: Request, name: string) {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name)
      return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

export function readSessionCookies(request: Request, hosted: boolean) {
  const prefix = hosted ? "__Host-" : "";
  return {
    accessToken: cookie(request, `${prefix}tarbiyah-access`),
    refreshToken: cookie(request, `${prefix}tarbiyah-refresh`),
  };
}

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

export function clearSessionCookies(response: NextResponse, hosted: boolean) {
  const prefix = hosted ? "__Host-" : "";
  const common = {
    httpOnly: true,
    secure: hosted,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(`${prefix}tarbiyah-access`, "", common);
  response.cookies.set(`${prefix}tarbiyah-refresh`, "", common);
}
