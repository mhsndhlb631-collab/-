import { p4Command, p4Query } from "../../../../server/p4-http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return p4Query(request, async (service) => {
    const data = await service.overview();
    return {
      actor_role: data.actor_role,
      exams: data.exams,
      enrollments: data.enrollments,
    };
  });
}
export function POST(request: Request) {
  return p4Command(request, (service, body, key) =>
    service.createExam(body, key),
  );
}
