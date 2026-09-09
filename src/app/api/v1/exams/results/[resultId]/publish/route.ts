import { p4Command } from "../../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ resultId: string }> },
) {
  const { resultId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.publishExamResult(resultId, body, key),
  );
}
