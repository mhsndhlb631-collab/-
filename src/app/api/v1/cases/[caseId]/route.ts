import { p5Query } from "../../../../../server/p5-http";
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/cases/[caseId]">,
) {
  const { caseId } = await context.params;
  return p5Query(request, (service) => service.caseDetail(caseId));
}
