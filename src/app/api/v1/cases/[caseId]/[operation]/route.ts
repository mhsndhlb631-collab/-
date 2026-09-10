import { AppError } from "../../../../../../domain/errors";
import { p5Command } from "../../../../../../server/p5-http";
const operations = [
  "events",
  "assign",
  "escalate",
  "resolve",
  "reopen",
  "archive",
] as const;
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/cases/[caseId]/[operation]">,
) {
  const { caseId, operation } = await context.params;
  if (!operations.includes(operation as (typeof operations)[number]))
    throw new AppError("NOT_FOUND");
  const command = operation === "events" ? "event" : operation;
  return p5Command(request, (service, body, key) =>
    service.caseCommand(
      caseId,
      command as
        "event" | "assign" | "escalate" | "resolve" | "reopen" | "archive",
      body,
      key,
    ),
  );
}
