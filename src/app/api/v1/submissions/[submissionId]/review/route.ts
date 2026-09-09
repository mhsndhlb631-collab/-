import { p4Command } from "../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.reviewSubmission(submissionId, body, key),
  );
}
