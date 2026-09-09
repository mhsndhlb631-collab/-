import "server-only";
import { P3TrackingService } from "../application/p3-tracking-service";
import { AppError } from "../domain/errors";
import { withAuthenticatedTransaction } from "./authenticated-db";
import { authEnvironment } from "./env";
import { assertSameOrigin, endpoint } from "./http";

export function p3Query(
  request: Request,
  action: (service: P3TrackingService) => Promise<unknown>,
) {
  return endpoint("p3-query", (requestId) =>
    withAuthenticatedTransaction(request, (tx, actor) =>
      action(new P3TrackingService(tx, actor, requestId)),
    ),
  );
}
export function p3Command(
  request: Request,
  action: (
    service: P3TrackingService,
    body: unknown,
    key: string | null,
  ) => Promise<unknown>,
) {
  return endpoint("p3-command", async (requestId) => {
    assertSameOrigin(request, authEnvironment(process.env).APP_ORIGIN);
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      throw new AppError("VALIDATION_ERROR");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("VALIDATION_ERROR");
    }
    try {
      return await withAuthenticatedTransaction(request, (tx, actor) =>
        action(
          new P3TrackingService(tx, actor, requestId),
          body,
          request.headers.get("idempotency-key"),
        ),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (code === "23505") throw new AppError("VERSION_CONFLICT");
      if (code === "40001") throw new AppError("VERSION_CONFLICT");
      if (code === "42501") throw new AppError("FORBIDDEN");
      if (["23503", "23514", "22P02"].includes(code))
        throw new AppError("VALIDATION_ERROR");
      throw error;
    }
  });
}
