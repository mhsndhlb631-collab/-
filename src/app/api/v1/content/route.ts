import { p4Command } from "../../../../server/p4-http";

export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return p4Command(request, (service, body, key) =>
    service.createContent(body, key),
  );
}
