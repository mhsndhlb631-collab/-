import "server-only";
import { P6ReportingService } from "../application/p6-reporting-service";
import { withAuthenticatedTransaction } from "./authenticated-db";
import { endpoint } from "./http";

export function p6Query(
  request: Request,
  action: (service: P6ReportingService) => Promise<unknown>,
) {
  return endpoint("p6-query", (requestId) =>
    withAuthenticatedTransaction(request, (tx, actor) =>
      action(new P6ReportingService(tx, actor, requestId)),
    ),
  );
}
