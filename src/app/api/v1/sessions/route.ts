import { p2Query } from "../../../../server/p2-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return p2Query(request, (service) => service.list());
}
