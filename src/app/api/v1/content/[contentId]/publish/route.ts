import { p4Command } from "../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const { contentId } = await context.params;
  return p4Command(request, (service, _body, key) =>
    service.publishContent(contentId, key),
  );
}
