import { AppError } from "../../../../../../domain/errors";
import { p5Command } from "../../../../../../server/p5-http";
const operations = [
  "start",
  "complete",
  "verify",
  "reschedule",
  "cancel",
] as const;
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/actions/[actionId]/[operation]">,
) {
  const { actionId, operation } = await context.params;
  if (!operations.includes(operation as (typeof operations)[number]))
    throw new AppError("NOT_FOUND");
  return p5Command(request, (service, body, key) =>
    service.actionTransition(
      actionId,
      operation as (typeof operations)[number],
      body,
      key,
    ),
  );
}
