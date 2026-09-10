import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

const parsed = z
  .object({
    SUPABASE_URL: z.url(),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    P8_STAGING_SUPABASE_URL: z.url(),
    P8_STAGING_DATABASE_URL: z.string().startsWith("postgres"),
  })
  .safeParse(process.env);

const evidence: Record<string, boolean> = {};
let diagnostic: string | undefined;
try {
  if (!parsed.success)
    throw new Error("separate staging environment is incomplete");
  const productionApi = new URL(parsed.data.SUPABASE_URL);
  const stagingApi = new URL(parsed.data.P8_STAGING_SUPABASE_URL);
  const productionDb = new URL(parsed.data.MIGRATION_DATABASE_URL);
  const stagingDb = new URL(parsed.data.P8_STAGING_DATABASE_URL);
  evidence.distinct_supabase_projects =
    productionApi.hostname !== stagingApi.hostname;
  evidence.distinct_database_targets =
    productionDb.hostname !== stagingDb.hostname ||
    productionDb.username !== stagingDb.username ||
    productionDb.pathname !== stagingDb.pathname;
  evidence.staging_is_not_localhost = !["localhost", "127.0.0.1"].includes(
    stagingApi.hostname,
  );
  if (Object.values(evidence).some((value) => !value))
    throw new Error("production and staging are not isolated");
  console.log("PASS: production and staging targets are distinct.");
} catch (error) {
  diagnostic = error instanceof Error ? error.message : "unknown";
  console.error(`BLOCKED: ${diagnostic}.`);
  process.exitCode = 1;
} finally {
  await mkdir("output/p8", { recursive: true });
  await writeFile(
    "output/p8/environments.json",
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
