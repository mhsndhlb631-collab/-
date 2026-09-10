import "server-only";
import { P7JourneyService } from "../application/p7-journey-service";
import { withAuthenticatedTransaction } from "./authenticated-db";
import { endpoint } from "./http";

export function p7Query(
  request: Request,
  action: (service: P7JourneyService) => Promise<unknown>,
) {
  return endpoint("p7-query", () =>
    withAuthenticatedTransaction(request, (tx, actor) =>
      action(new P7JourneyService(tx, actor)),
    ),
  );
}
