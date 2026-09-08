import { p1Command } from "../../../../server/p1-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return p1Command(request, (service, body, key) =>
    service.assignMentor(body, key),
  );
}
