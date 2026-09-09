import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { deriveRuntimeDatabaseUrl } from "../src/server/runtime-url.ts";

loadEnvFile(".env.local");
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const runtimePassword = process.env.RUNTIME_DATABASE_PASSWORD;
if (!migrationUrl || !runtimePassword) {
  console.error("BLOCKED: local runtime database configuration is incomplete.");
  process.exit(1);
}
const child = spawn("npm.cmd", ["run", "dev"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: deriveRuntimeDatabaseUrl({ migrationUrl, runtimePassword }),
  },
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
