import "server-only";
import { P2SessionService } from "../application/p2-session-service";
import { AppError } from "../domain/errors";
import { withAuthenticatedTransaction } from "./authenticated-db";
import { authEnvironment } from "./env";
import { assertSameOrigin, endpoint } from "./http";
export function p2Query(
  request: Request,
  action: (service: P2SessionService) => Promise<unknown>,
) {
  return endpoint("p2-query", (requestId) =>
    withAuthenticatedTransaction(request, (tx, actor) =>
      action(new P2SessionService(tx, actor, requestId)),
    ),
  );
}
export function p2Command(
  request: Request,
  action: (
    service: P2SessionService,
    body: unknown,
    key: string | null,
  ) => Promise<unknown>,
) {
  return endpoint("p2-command", async (requestId) => {
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
          new P2SessionService(tx, actor, requestId),
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
      if (code === "23505") throw new AppError("INVALID_STATE_TRANSITION");
      if (["23503", "23514", "22P02"].includes(code))
        throw new AppError("VALIDATION_ERROR");
      throw error;
    }
  });
}
