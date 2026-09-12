import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");
const [serviceWorker, manifest, layout, shell, commands, repository, preload] =
  await Promise.all([
    read("public/sw.js"),
    read("src/app/manifest.ts"),
    read("src/app/globals.css"),
    read("src/app/operations-shell.tsx"),
    read("src/offline/commands.ts"),
    read("src/offline/repository.ts"),
    read("src/offline/preload.ts"),
  ]);

const checks = [];
function check(name, condition) {
  assert(condition, name);
  checks.push({ name, status: "PASS" });
}

check(
  "service_worker_api_bypass",
  serviceWorker.includes('pathname.startsWith("/api/")'),
);
check(
  "service_worker_non_get_bypass",
  serviceWorker.includes('request.method !== "GET"'),
);
check(
  "offline_navigation_fallback",
  serviceWorker.includes('cache.match("/offline.html")'),
);
check("pwa_standalone", manifest.includes('display: "standalone"'));
check("pwa_maskable_icon", manifest.includes('purpose: "maskable"'));
check(
  "stable_idempotency_header",
  commands.includes('"Idempotency-Key": idempotencyKey'),
);
check("durable_outbox", repository.includes("this.db.outbox"));
check("safe_synced_cleanup", repository.includes('item.status === "synced"'));
check("role_scoped_preload", preload.includes('role === "RESPONSIBLE"'));
check("bounded_session_preload", preload.includes(".slice(0, 12)"));
check("rtl_document", shell.includes("التنقل الرئيسي للهاتف"));
check("mobile_navigation", shell.includes('className="mobile-bottom-nav"'));
check("safe_area_bottom", layout.includes("env(safe-area-inset-bottom)"));
check("safe_area_top", layout.includes("env(safe-area-inset-top)"));
check("small_phone_contract", layout.includes("max-width: 360px"));
check("touch_target_contract", /min-height:\s*44px/.test(layout));
check("sticky_field_save", shell.includes('className="roster-save-bar"'));
check("password_manager_username", shell.includes('autoComplete="username"'));
check(
  "password_manager_password",
  shell.includes('autoComplete="current-password"'),
);

const output = {
  stage: "offline_mobile_static_contract",
  generated_at: new Date().toISOString(),
  status: "PASS",
  checks,
  sensitive_values_included: false,
};
await mkdir(join(root, "output", "offline-mobile"), { recursive: true });
await writeFile(
  join(root, "output", "offline-mobile", "acceptance.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(`PASS: ${checks.length} offline/mobile production contracts`);
