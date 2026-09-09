import { p4Command } from "../../../../../../server/p4-http";
export async function PUT(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.submitAssignment(assignmentId, body, key),
  );
}
