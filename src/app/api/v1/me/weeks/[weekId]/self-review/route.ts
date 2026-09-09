import { p4Command } from "../../../../../../../server/p4-http";
export async function PUT(
  request: Request,
  context: { params: Promise<{ weekId: string }> },
) {
  const { weekId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.selfReview(weekId, body, key),
  );
}
