import { p3Command } from "../../../../../server/p3-http";
export const runtime = "nodejs";
export function PUT(request: Request) {
  return p3Command(request, (service, body, key) =>
    service.save(body, key, false),
  );
}
