import { p5Query } from "../../../../server/p5-http";
export async function GET(request: Request) {
  return p5Query(request, async (service) => ({
    attentions: (await service.overview()).attentions,
  }));
}
