import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { z } from "zod";

const parsed = z
  .object({
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    P8_RECOVERY_DATABASE_URL: z.string().startsWith("postgres"),
  })
  .safeParse(process.env);
const evidence: Record<string, boolean | number> = {};
let diagnostic: string | undefined;
let recovery: ReturnType<typeof postgres> | undefined;

try {
  if (!parsed.success)
    throw new Error("isolated recovery database is not configured");
  const source = new URL(parsed.data.MIGRATION_DATABASE_URL);
  const target = new URL(parsed.data.P8_RECOVERY_DATABASE_URL);
  if (
    source.hostname === target.hostname &&
    source.username === target.username &&
    source.pathname === target.pathname
  )
    throw new Error("recovery target equals the production database");
  evidence.isolated_target = true;
  recovery = postgres(parsed.data.P8_RECOVERY_DATABASE_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 8,
  });
  const files = (await readdir("db/migrations"))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const sourceSql = await readFile(`db/migrations/${file}`, "utf8");
    await recovery.unsafe(sourceSql);
    const version = file.slice(0, -4);
    const checksum = createHash("sha256").update(sourceSql).digest("hex");
    await recovery`insert into app.schema_migrations(version,checksum) values(${version},${checksum}) on conflict(version) do nothing`;
  }
  evidence.migrations_rebuilt = files.length;
  const workspace = randomUUID();
  await recovery`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P8 recovery canary','Africa/Cairo',6)`;
  const rows = await recovery<
    { name: string }[]
  >`select name from app.workspaces where id=${workspace}::uuid`;
  if (rows[0]?.name !== "P8 recovery canary")
    throw new Error("recovery canary round trip failed");
  await recovery`delete from app.workspaces where id=${workspace}::uuid`;
  evidence.canary_round_trip = true;
  evidence.schema_integrity =
    Number(
      (
        await recovery<
          { count: number }[]
        >`select count(*)::int count from app.schema_migrations`
      )[0]?.count,
    ) === files.length;
  if (!evidence.schema_integrity)
    throw new Error("recovery schema checksum inventory failed");
  console.log("PASS: isolated recovery rebuild and integrity checks passed.");
} catch (error) {
  diagnostic = error instanceof Error ? error.message : "unknown";
  console.error(`BLOCKED: P8 recovery check: ${diagnostic}.`);
  process.exitCode = 1;
} finally {
  if (recovery) await recovery.end();
  await mkdir("output/p8", { recursive: true });
  await writeFile(
    "output/p8/recovery.json",
    JSON.stringify(
      {
        result: diagnostic ? "BLOCKED" : "PASS",
        at: new Date().toISOString(),
        evidence,
        ...(diagnostic ? { diagnostic } : {}),
      },
      null,
      2,
    ),
  );
}
