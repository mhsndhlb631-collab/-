import { p5Command } from "../../../../../../server/p5-http";
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/followups/[followupId]/corrections">,
) {
  const { followupId } = await context.params;
  return p5Command(request, (service, body, key) =>
    service.correctFollowup(followupId, body, key),
  );
}
