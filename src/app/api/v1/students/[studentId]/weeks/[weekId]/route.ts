import { p4Query } from "../../../../../../../server/p4-http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ studentId: string; weekId: string }> },
) {
  const { studentId, weekId } = await context.params;
  return p4Query(request, (service) => service.week(studentId, weekId));
}
