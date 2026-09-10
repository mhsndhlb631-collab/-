import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, safeError } from "../../../../../domain/errors";
import { authEnvironment } from "../../../../../server/env";
import { assertSameOrigin, logRequest } from "../../../../../server/http";
import { endProviderSession } from "../../../../../server/self-service-auth";
import { clearSessionCookies } from "../../../../../server/session-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = randomUUID();
  let status = 200;
  try {
    const env = authEnvironment(process.env),
      hosted = env.APP_ENV === "staging" || env.APP_ENV === "production";
    assertSameOrigin(request, env.APP_ORIGIN);
    try {
      await endProviderSession(request);
    } catch {
      // Cookie deletion remains valid when the provider session already expired.
    }
    const response = NextResponse.json(
      { next: "LOGIN", request_id: requestId },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
    clearSessionCookies(response, hosted);
    logRequest({ requestId, operation: "auth", status });
    return response;
  } catch (error) {
    const failure = safeError(
      error instanceof AppError ? error : new AppError("UNAUTHENTICATED"),
      requestId,
    );
    status = failure.status;
    logRequest({ requestId, operation: "auth", status });
    return NextResponse.json(failure.body, { status });
  }
}
