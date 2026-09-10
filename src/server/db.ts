import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { databaseUrl, parseEnvironment } from "./env";
import { AppError } from "../domain/errors";
import { runtimeRoleSafetySql } from "./runtime-role";

let client: ReturnType<typeof postgres> | undefined;
export function runtimeSql() {
  client ??= postgres(databaseUrl(process.env), {
    prepare: false,
    // The transaction pooler multiplexes these short-lived client sessions;
    // cap them at the documented 20-user reference workload.
    max: 20,
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
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role tarbiyah_runtime");
      const [role] = await tx.unsafe<{ safe: boolean }[]>(runtimeRoleSafetySql);
      if (!role?.safe) throw new Error("Unsafe runtime role");
      const [version] =
        await tx`select version from app.schema_migrations where version='0030_p7_self_service_auth'`;
      if (!version) throw new Error("Missing migration");
    });
    return { status: "ready" };
  } catch {
    throw new AppError("DEPENDENCY_UNAVAILABLE");
  }
}
