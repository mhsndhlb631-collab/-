import "server-only";
import {
  MentorOperationsService,
  mentorOperationsCommand,
} from "../application/mentor-operations-service";
import { AppError } from "../domain/errors";
import { withAuthenticatedTransaction } from "./authenticated-db";
import { authEnvironment } from "./env";
import { assertSameOrigin, endpoint } from "./http";

export function mentorOperationsQuery(request: Request) {
  return endpoint("p4-query", async (requestId) => {
    const url = new URL(request.url);
    return withAuthenticatedTransaction(request, async (tx, actor) => {
      const service = new MentorOperationsService(tx, actor, requestId);
      return url.searchParams.get("view") === "intelligence"
        ? service.intelligence()
        : service.overview();
    });
  });
}

export function mentorOperationsMutation(request: Request) {
  return endpoint("p4-command", async (requestId) => {
    assertSameOrigin(request, authEnvironment(process.env).APP_ORIGIN);
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      throw new AppError("VALIDATION_ERROR");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("VALIDATION_ERROR");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AppError("VALIDATION_ERROR");
    }
    const parsed = mentorOperationsCommand.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR");
    try {
      if (parsed.data.action === "CREATE_ASSIGNMENT")
        return await withAuthenticatedTransaction(request, (tx, actor) =>
          new MentorOperationsService(tx, actor, requestId).createAssignment(
            parsed.data.payload,
            idempotencyKey,
          ),
        );
      return await withAuthenticatedTransaction(request, (tx, actor) =>
        new MentorOperationsService(tx, actor, requestId).saveEvaluations(
          parsed.data.payload,
          idempotencyKey,
        ),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (["23505", "40001"].includes(code))
        throw new AppError("VERSION_CONFLICT");
      if (code === "42501") throw new AppError("FORBIDDEN");
      if (["23503", "23514", "22P02"].includes(code))
        throw new AppError("VALIDATION_ERROR");
      throw error;
    }
  });
}
