import { p4Command } from "../../../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ studentId: string; weekId: string }> },
) {
  const { studentId, weekId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.approveWeek(studentId, weekId, body, key, true),
  );
}
