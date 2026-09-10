import { mkdir, writeFile } from "node:fs/promises";

const origin = new URL(
  process.env.HOSTED_ORIGIN ?? "https://tarbiyah-operations.vercel.app",
).origin;
const timeoutMs = 10_000;

type Probe = {
  path: string;
  status: number;
  duration_ms: number;
  request_id: boolean;
  cache_control: string | null;
  body_status?: string;
};

async function probe(path: string): Promise<Probe> {
  const started = performance.now();
  const response = await fetch(`${origin}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const duration = Math.round((performance.now() - started) * 10) / 10;
  const body = (await response.json()) as { status?: string };
  return {
    path,
    status: response.status,
    duration_ms: duration,
    request_id: /^[0-9a-f-]{36}$/i.test(
      response.headers.get("x-request-id") ?? "",
    ),
    cache_control: response.headers.get("cache-control"),
    body_status: body.status,
  };
}

const report: {
  result: "PASS" | "FAIL";
  at: string;
  origin: string;
  probes: Probe[];
  diagnostic?: string;
} = { result: "FAIL", at: new Date().toISOString(), origin, probes: [] };

try {
  report.probes = await Promise.all([probe("/health"), probe("/ready")]);
  const passed = report.probes.every(
    (item) =>
      item.status === 200 &&
      item.request_id &&
      item.cache_control?.includes("no-store") &&
      item.body_status !== undefined,
  );
  if (!passed) throw new Error("availability contract failed");
  report.result = "PASS";
  console.log("PASS: production health and readiness are available.");
} catch (error) {
  report.diagnostic = error instanceof Error ? error.name : "UnknownError";
  console.error("FAIL: production availability probe failed.");
  process.exitCode = 1;
} finally {
  if (process.argv.includes("--evidence")) {
    await mkdir("output/p8", { recursive: true });
    await writeFile(
      "output/p8/monitoring.json",
      JSON.stringify(report, null, 2),
    );
  }
}
