import { p5Command, p5Query } from "../../../../server/p5-http";
export async function GET(request: Request) {
  return p5Query(request, async (service) => ({
    cases: (await service.overview()).cases,
  }));
}
export async function POST(request: Request) {
  return p5Command(request, (service, body, key) =>
    service.createCase(body, key),
  );
}
