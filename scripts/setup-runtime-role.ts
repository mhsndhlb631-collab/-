import postgres from "postgres";
import { z } from "zod";

const config = z
  .object({
    APP_ENV: z.enum(["local", "test", "staging"]),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    RUNTIME_DATABASE_PASSWORD: z.string().min(24).max(256),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error(
    "BLOCKED: APP_ENV, MIGRATION_DATABASE_URL and an independent RUNTIME_DATABASE_PASSWORD (24+ chars) are required.",
  );
  process.exit(1);
}

const sql = postgres(config.data.MIGRATION_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 5,
});

try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(80261402)`;
    await tx`select set_config('app.bootstrap_runtime_password', ${config.data.RUNTIME_DATABASE_PASSWORD}, true)`;
    await tx.unsafe(`
      DO $bootstrap$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tarbiyah_app_runtime') THEN
          EXECUTE format('CREATE ROLE tarbiyah_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS PASSWORD %L',
            current_setting('app.bootstrap_runtime_password'));
        END IF;
        GRANT tarbiyah_runtime TO tarbiyah_app_runtime;
      END
      $bootstrap$;
    `);
    const [result] = await tx<{ safe: boolean }[]>`
      select not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolinherit
        and pg_has_role('tarbiyah_app_runtime','tarbiyah_runtime','member')
        and not pg_has_role('tarbiyah_app_runtime','postgres','member') as safe
      from pg_roles where rolname='tarbiyah_app_runtime'`;
    if (!result?.safe) throw new Error("Unsafe runtime role");
  });
  console.log(
    "PASS: limited tarbiyah_app_runtime login exists with tarbiyah_runtime membership and no elevated attributes.",
  );
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code).replace(/[^A-Z0-9]/g, "")
      : "UNKNOWN";
  console.error(
    `FAIL: runtime role setup failed (PostgreSQL code ${code}). No connection string, password or database detail was printed.`,
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
