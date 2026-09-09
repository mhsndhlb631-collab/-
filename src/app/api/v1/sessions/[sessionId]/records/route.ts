import { p2Command } from "../../../../../../server/p2-http";
export const runtime = "nodejs";
export async function PUT(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  return p2Command(request, (service, body, key) =>
    service.save(sessionId, body, key),
  );
}
