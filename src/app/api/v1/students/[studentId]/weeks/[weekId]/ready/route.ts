import { p4Command } from "../../../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ studentId: string; weekId: string }> },
) {
  const { studentId, weekId } = await context.params;
  return p4Command(request, (service, _body, key) =>
    service.prepareWeek(studentId, weekId, key),
  );
}
