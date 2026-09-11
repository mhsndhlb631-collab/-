import { peopleCommand, peopleQuery } from "../../../../server/people-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return peopleQuery(request);
}

export function POST(request: Request) {
  return peopleCommand(request);
}
