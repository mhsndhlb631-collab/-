import { randomUUID } from "node:crypto";
import { AppError, safeError } from "../domain/errors";

/** No caller-provided body, URL, headers, user object, error message or stack is logged. */
export function logRequest(event: {
  requestId: string;
  operation:
    | "health"
    | "ready"
    | "login"
    | "p1-command"
    | "p1-query"
    | "p2-command"
    | "p2-query";
  status: number;
}) {
  console.info(
    JSON.stringify({
      event: "request_completed",
      request_id: event.requestId,
      operation: event.operation,
      status: event.status,
    }),
  );
}
export async function endpoint(
  operation:
    | "health"
    | "ready"
    | "login"
    | "p1-command"
    | "p1-query"
    | "p2-command"
    | "p2-query",
  action: (requestId: string) => Promise<unknown>,
) {
  const id = randomUUID(); // do not trust client request IDs as log contents
  let status = 200;
  let body: unknown;
  try {
    body = { ...((await action(id)) as object), request_id: id };
  } catch (error) {
    const technicalCode =
      typeof error === "object" &&
      error &&
      "code" in error &&
      /^[A-Z0-9_]{1,32}$/i.test(String(error.code))
        ? String(error.code)
        : error instanceof Error
          ? error.name
          : "UnknownError";
    console.error(
      JSON.stringify({
        event: "request_failed",
        request_id: id,
        operation,
        technical_code: technicalCode,
        technical_stage:
          typeof error === "object" &&
          error &&
          "technicalStage" in error &&
          /^[a-z_]{1,32}$/.test(String(error.technicalStage))
            ? String(error.technicalStage)
            : undefined,
        technical_routine:
          typeof error === "object" &&
          error &&
          "routine" in error &&
          /^[A-Za-z_]{1,64}$/.test(String(error.routine))
            ? String(error.routine)
            : undefined,
      }),
    );
    const failure = safeError(error, id);
    status = failure.status;
    body = failure.body;
  }
  logRequest({ requestId: id, operation, status });
  return Response.json(body, {
    status,
    headers: { "X-Request-ID": id, "Cache-Control": "no-store" },
  });
}
export function assertSameOrigin(request: Request, configuredOrigin: string) {
  if (request.headers.get("origin") !== new URL(configuredOrigin).origin)
    throw new AppError("FORBIDDEN");
}
