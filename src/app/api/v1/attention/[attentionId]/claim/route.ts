import { p5Command } from "../../../../../../server/p5-http";
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/attention/[attentionId]/claim">,
) {
  const { attentionId } = await context.params;
  return p5Command(request, (service, body, key) =>
    service.attentionTransition(attentionId, "claim", body, key),
  );
}
