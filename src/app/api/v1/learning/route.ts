import { p4Query } from "../../../../server/p4-http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return p4Query(request, (service) => service.overview());
}
