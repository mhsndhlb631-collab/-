import { p1Command } from "../../../../../../server/p1-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await context.params;
  return p1Command(request, (service, body, key) =>
    service.publishTemplatePlan(templateId, body, key),
  );
}
