import { p6Query } from "../../../../../../server/p6-http";
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/mentors/[mentorId]/performance">,
) {
  const { mentorId } = await context.params;
  return p6Query(request, (service) =>
    service.performance(
      mentorId,
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  );
}
