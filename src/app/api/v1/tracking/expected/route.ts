import { p3Query } from "../../../../../server/p3-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return p3Query(request, (service) =>
    service.expected(new URL(request.url).searchParams),
  );
}
