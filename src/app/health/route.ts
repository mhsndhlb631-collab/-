import { endpoint } from "../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return endpoint("health", async () => ({ status: "ok" }));
}
