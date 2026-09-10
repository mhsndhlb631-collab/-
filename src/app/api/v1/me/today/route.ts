import { p7Query } from "../../../../../server/p7-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  p7Query(request, (service) => service.today());
