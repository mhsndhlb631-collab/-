import postgres from "postgres";
import { z } from "zod";
import { deriveRuntimeDatabaseUrl } from "../src/server/runtime-url.ts";
import { runtimeRoleSafetySql } from "../src/server/runtime-role.ts";

const config = z
  .object({
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    RUNTIME_DATABASE_PASSWORD: z.string().min(24),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error("BLOCKED: runtime verification environment is incomplete.");
  process.exit(1);
}

let url: string;
try {
  url = deriveRuntimeDatabaseUrl({
    migrationUrl: config.data.MIGRATION_DATABASE_URL,
    runtimePassword: config.data.RUNTIME_DATABASE_PASSWORD,
  });
} catch {
  console.error(
    "BLOCKED: migration URI is not the expected Supabase Session pooler URI.",
  );
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 5,
});

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role tarbiyah_runtime");
    const [role] = await tx.unsafe<{ safe: boolean }[]>(runtimeRoleSafetySql);
    if (!role?.safe) throw new Error("Unsafe runtime role");
    const rows = await tx`select id from app.workspaces`;
    if (rows.length !== 0) throw new Error("Default-deny RLS failed");
  });
  let writeDenied = false;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role tarbiyah_runtime");
      await tx`insert into app.workspaces(name,timezone,week_starts_on)
        values('must-not-write','Africa/Cairo',6)`;
    });
  } catch {
    writeDenied = true;
  }
  if (!writeDenied)
    throw new Error("Runtime received an unreviewed domain write grant");
  // Transaction-local role selection must not leak to a reused pooled connection.
  const [outside] = await sql<{ current_user: string }[]>`select current_user`;
  if (outside?.current_user !== "tarbiyah_app_runtime") {
    throw new Error("Transaction role leaked");
  }
  console.log(
    "PASS: real Supabase transaction-pooler login uses a transaction-local limited role, is default-denied by RLS, cannot write domain tables, and leaks no role across transactions.",
  );
} catch {
  console.error(
    "FAIL: real runtime-role acceptance failed. No URL, credential, role detail or database error was printed.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
