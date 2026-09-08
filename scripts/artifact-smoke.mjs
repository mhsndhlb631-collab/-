import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";

// Reserve an available local port, then boot the actual built artifact, never next dev.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "",
      MIGRATION_DATABASE_URL: "",
    },
    stdio: "ignore",
    windowsHide: true,
  },
);
const base = `http://127.0.0.1:${port}`;
try {
  let live = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null)
      throw new Error("Built artifact exited before readiness");
    try {
      const response = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      live = response.ok;
    } catch {}
    if (live) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(live, "Built artifact did not start");
  const health = await fetch(`${base}/health`);
  const body = await health.json();
  assert.equal(body.status, "ok");
  assert.equal(health.headers.get("x-request-id"), body.request_id);
  assert.equal(health.headers.get("cache-control"), "no-store");
  const ready = await fetch(`${base}/ready`);
  assert.equal(
    ready.status,
    503,
    "Readiness must fail closed without runtime database credentials",
  );
  assert.equal((await ready.json()).code, "DEPENDENCY_UNAVAILABLE");
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /dir="rtl"/);
  console.log(
    "PASS: production artifact, health, request ID, no-store, missing-DB readiness, RTL shell",
  );
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
}
