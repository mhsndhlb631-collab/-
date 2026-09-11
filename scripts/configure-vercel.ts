import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { deriveRuntimeDatabaseUrl } from "../src/server/runtime-url.ts";

loadEnvFile(".env.local");

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local variable: ${name}`);
  return value;
}

function vercel(args: string[], input?: string) {
  const result = spawnSync("npx.cmd", ["--yes", "vercel@latest", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    let detail =
      result.stderr ||
      result.stdout ||
      result.error?.message ||
      "unknown error";
    for (const secret of Object.values(values ?? {}))
      detail = detail.replaceAll(secret, "[redacted]");
    throw new Error(`Vercel command failed: ${detail.trim()}`);
  }
}

const values = {
  APP_ENV: "production",
  APP_ORIGIN: "https://tarbiyah-operations.vercel.app",
  DATABASE_URL: deriveRuntimeDatabaseUrl({
    migrationUrl: required("MIGRATION_DATABASE_URL"),
    runtimePassword: required("RUNTIME_DATABASE_PASSWORD"),
  }),
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_PUBLISHABLE_KEY: required("SUPABASE_PUBLISHABLE_KEY"),
  SUPABASE_SECRET_KEY: required("SUPABASE_SECRET_KEY"),
  AUTH_INTERNAL_EMAIL_DOMAIN: required("AUTH_INTERNAL_EMAIL_DOMAIN"),
  AUTH_RATE_LIMIT_SECRET: required("AUTH_RATE_LIMIT_SECRET"),
};

for (const [name, value] of Object.entries(values)) {
  vercel(
    [
      "env",
      "add",
      name,
      "production",
      "--force",
      ...(name === "SUPABASE_SECRET_KEY" ? ["--sensitive"] : []),
    ],
    `${value}\n`,
  );
  console.log(`configured ${name}`);
}
for (const name of ["MIGRATION_DATABASE_URL"]) {
  vercel(["env", "rm", name, "production", "--yes"]);
  console.log(`removed ${name}`);
}
