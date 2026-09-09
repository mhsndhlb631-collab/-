import { p4Command } from "../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ examId: string }> },
) {
  const { examId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.saveExamResult(examId, body, key, true),
  );
}
