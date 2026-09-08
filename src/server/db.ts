import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { databaseUrl, parseEnvironment } from "./env";
import { AppError } from "../domain/errors";
import { runtimeRoleSafetySql } from "./runtime-role";

let client: ReturnType<typeof postgres> | undefined;
export function runtimeSql() {
  client ??= postgres(databaseUrl(process.env), {
    prepare: false,
    max: 3,
    connect_timeout: 5,
    idle_timeout: 20,
  });
  return client;
}
export function runtimeDb() {
  return drizzle(runtimeSql());
}
export async function readiness() {
  try {
    parseEnvironment(process.env);
    const sql = runtimeSql();
    const [role] = await sql.unsafe<{ safe: boolean }[]>(runtimeRoleSafetySql);
    if (!role?.safe) throw new Error("Unsafe runtime role");
    const [version] =
      await sql`select version from app.schema_migrations where version='0001_foundation'`;
    if (!version) throw new Error("Missing migration");
    return { status: "ready" };
  } catch {
    throw new AppError("DEPENDENCY_UNAVAILABLE");
  }
}
