import { p2Query } from "../../../../../server/p2-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  return p2Query(request, (service) => service.detail(sessionId));
}
