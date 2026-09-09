import postgres from "postgres";
import { z } from "zod";
const env = z
  .object({ MIGRATION_DATABASE_URL: z.string().startsWith("postgres") })
  .parse(process.env);
const sql = postgres(env.MIGRATION_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 5,
});
try {
  const [result] = await sql`select
    has_table_privilege('tarbiyah_runtime','app.idempotency_records','INSERT') as idempotency_insert,
    has_table_privilege('tarbiyah_runtime','app.idempotency_records','SELECT') as idempotency_select,
    has_table_privilege('tarbiyah_runtime','app.idempotency_records','UPDATE') as idempotency_update,
    has_table_privilege('tarbiyah_runtime','app.program_templates','INSERT') as template_insert,
    exists(select 1 from pg_policies where schemaname='app' and tablename='idempotency_records' and policyname='idempotency_actor_insert') as insert_policy`;
  console.log(JSON.stringify(result));
} finally {
  await sql.end();
}
