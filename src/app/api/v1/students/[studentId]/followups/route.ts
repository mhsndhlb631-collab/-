import { p5Command, p5Query } from "../../../../../../server/p5-http";
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/students/[studentId]/followups">,
) {
  const { studentId } = await context.params;
  return p5Query(request, async (service) => ({
    followups: await service.followupsForStudent(studentId),
  }));
}
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/students/[studentId]/followups">,
) {
  const { studentId } = await context.params;
  return p5Command(request, (service, body, key) =>
    service.createFollowup(studentId, body, key),
  );
}
