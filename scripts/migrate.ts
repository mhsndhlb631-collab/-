import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error(
    "BLOCKED: MIGRATION_DATABASE_URL is required; no runtime fallback.",
  );
  process.exit(1);
}
if (!["local", "test", "staging"].includes(process.env.APP_ENV ?? "")) {
  console.error(
    "BLOCKED: explicitly select local/test/staging; production migrations need a reviewed release procedure.",
  );
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });
try {
  const source = await readFile("db/migrations/0001_foundation.sql", "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(80261401)`;
    const [table] =
      await tx`select to_regclass('app.schema_migrations') as present`;
    if (table.present) {
      const [applied] =
        await tx`select checksum from app.schema_migrations where version='0001_foundation'`;
      if (!applied || applied.checksum !== checksum)
        throw new Error("Migration drift");
      console.log("PASS: 0001_foundation already applied, checksum matches");
      return;
    }
    await tx.unsafe(source);
    await tx`insert into app.schema_migrations(version,checksum) values('0001_foundation',${checksum})`;
    console.log("PASS: 0001_foundation applied");
  });
} catch {
  console.error(
    "FAIL: migration failed; inspect the database using the secure operator connection. No credentials or SQL details printed.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
