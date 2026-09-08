import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !["local", "test", "staging"].includes(process.env.APP_ENV ?? "")) {
  console.error("BLOCKED: safe migration environment is incomplete.");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });
try {
  const files = (await readdir("db/migrations"))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
    .sort();
  if (files[0] !== "0001_foundation.sql")
    throw new Error("Invalid migration set");
  for (const file of files) {
    const version = file.slice(0, -4);
    const source = await readFile(`db/migrations/${file}`, "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(80261401)`;
      const [table] =
        await tx`select to_regclass('app.schema_migrations') as present`;
      if (table.present) {
        const [applied] =
          await tx`select checksum from app.schema_migrations where version=${version}`;
        if (applied) {
          if (applied.checksum !== checksum) throw new Error("Migration drift");
          console.log(`PASS: ${version} already applied, checksum matches`);
          return;
        }
      } else if (version !== "0001_foundation")
        throw new Error("Foundation missing");
      await tx.unsafe(source);
      await tx`insert into app.schema_migrations(version,checksum) values(${version},${checksum})`;
      console.log(`PASS: ${version} applied`);
    });
  }
} catch {
  console.error(
    "FAIL: migration failed; no credentials or SQL details printed.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
