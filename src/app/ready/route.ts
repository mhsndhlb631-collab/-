import { endpoint } from "../../server/http";
import { readiness } from "../../server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return endpoint("ready", readiness);
}
