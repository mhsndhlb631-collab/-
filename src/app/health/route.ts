import { endpoint } from "../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return endpoint("health", async () => ({
    status: "ok",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
  }));
}
