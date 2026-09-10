import { p5Command } from "../../../../../server/p5-http";
export async function POST(request: Request) {
  return p5Command(request, (service, body, key) =>
    service.evaluate(body, key),
  );
}
