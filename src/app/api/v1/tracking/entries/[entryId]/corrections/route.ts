import { p3Command } from "../../../../../../../server/p3-http";
export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  return p3Command(request, async (service, body, key) =>
    service.correct((await context.params).entryId, body, key),
  );
}
