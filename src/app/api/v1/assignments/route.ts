import { p4Query } from "../../../../server/p4-http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return p4Query(request, async (service) => {
    const data = await service.overview();
    return {
      actor_role: data.actor_role,
      assignments: data.assignments,
      enrollments: data.enrollments,
    };
  });
}
