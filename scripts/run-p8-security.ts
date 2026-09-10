import { mkdir, writeFile } from "node:fs/promises";

const origin = new URL(
  process.env.HOSTED_ORIGIN ?? "https://tarbiyah-operations.vercel.app",
).origin;
type Check = { name: string; pass: boolean; status?: number; code?: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, details: Partial<Check> = {}) {
  checks.push({ name, pass, ...details });
  if (!pass) throw new Error(name);
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual",
    ...init,
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  const serialized = JSON.stringify(body).toLowerCase();
  record(
    `no_sensitive_error_material:${path}`,
    !/(postgresql:\/\/|bearer |service_role|supabase_secret|stack\s*trace)/i.test(
      serialized,
    ),
    { status: response.status, code: String(body.code ?? "") },
  );
  return { response, body };
}

let failure: string | undefined;
try {
  const home = await fetch(origin, { redirect: "manual" });
  const expectedHeaders = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
  } as const;
  for (const [name, expected] of Object.entries(expectedHeaders))
    record(
      `security_header:${name}`,
      home.headers.get(name)?.toLowerCase() === expected.toLowerCase(),
      { status: home.status },
    );

  const unauthenticated = await json("/api/v1/me");
  record(
    "unauthenticated_private_route_denied",
    unauthenticated.response.status === 401 &&
      unauthenticated.body.code === "UNAUTHENTICATED",
    {
      status: unauthenticated.response.status,
      code: String(unauthenticated.body.code ?? ""),
    },
  );

  const crossOrigin = await json("/api/v1/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://invalid-origin.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ login_name: "security_probe", password: "invalid" }),
  });
  record(
    "cross_origin_mutation_denied",
    crossOrigin.response.status === 403 &&
      crossOrigin.body.code === "FORBIDDEN",
    {
      status: crossOrigin.response.status,
      code: String(crossOrigin.body.code ?? ""),
    },
  );

  const malformed = await json("/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{",
  });
  record(
    "malformed_json_rejected_safely",
    malformed.response.status === 400 &&
      malformed.body.code === "VALIDATION_ERROR",
    {
      status: malformed.response.status,
      code: String(malformed.body.code ?? ""),
    },
  );

  const method = await fetch(`${origin}/api/v1/auth/logout`, { method: "GET" });
  record("get_does_not_mutate_logout", method.status === 405, {
    status: method.status,
  });
  console.log("PASS: production security boundary checks passed.");
} catch (error) {
  failure = error instanceof Error ? error.message : "unknown";
  console.error(`FAIL: P8 security check failed at ${failure}.`);
  process.exitCode = 1;
} finally {
  await mkdir("output/p8", { recursive: true });
  await writeFile(
    "output/p8/security.json",
    JSON.stringify(
      {
        result: failure ? "FAIL" : "PASS",
        at: new Date().toISOString(),
        checks,
        ...(failure ? { failing_check: failure } : {}),
      },
      null,
      2,
    ),
  );
}
