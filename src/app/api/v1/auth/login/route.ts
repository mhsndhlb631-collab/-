import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, safeError } from "../../../../../domain/errors";
import { authEnvironment } from "../../../../../server/env";
import { assertSameOrigin, logRequest } from "../../../../../server/http";
import { loginService } from "../../../../../server/login-services";
import { loginBody, trustedNetworkKey } from "../../../../../server/login-http";
import { setSessionCookies } from "../../../../../server/session-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = randomUUID();
  let status = 200;
  try {
    const env = authEnvironment(process.env);
    assertSameOrigin(request, env.APP_ORIGIN);
    const contentType = request.headers.get("content-type")?.split(";")[0];
    if (contentType !== "application/json")
      throw new AppError("VALIDATION_ERROR");
    const body = loginBody(await request.json());
    const hosted = env.APP_ENV === "staging" || env.APP_ENV === "production";
    const result = await loginService().execute({
      loginName: body.loginName,
      password: body.password,
      networkKey: trustedNetworkKey(request, hosted),
    });
    const response = NextResponse.json(
      { next: result.next, request_id: requestId },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
    setSessionCookies(response, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      hosted,
    });
    logRequest({ requestId, operation: "login", status });
    return response;
  } catch (error) {
    const failure = safeError(error, requestId);
    status = failure.status;
    logRequest({ requestId, operation: "login", status });
    return NextResponse.json(failure.body, {
      status,
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  }
}
