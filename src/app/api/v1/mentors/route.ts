import { p6Query } from "../../../../server/p6-http";
export async function GET(request: Request) {
  return p6Query(request, async (service) => ({
    mentors: await service.mentors(),
  }));
}
