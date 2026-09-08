import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runtimeRoleSafetySql } from "../src/server/runtime-role.ts";

// Never load these credentials in the browser or return a provider User/Session.
// This script intentionally changes the disposable account's cutoff and leaves it advanced.
const config = z
  .object({
    APP_ENV: z.literal("staging"),
    SPIKE_ACK_DEDICATED_PROJECT: z.literal("yes"),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
    DATABASE_URL: z.string().startsWith("postgres"),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    AUTH_INTERNAL_EMAIL_DOMAIN: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
    SPIKE_ACCOUNT_ID: z.uuid(),
    SPIKE_ACTOR_ACCOUNT_ID: z.uuid(),
    SPIKE_PASSWORD: z.string().min(12),
  })
  .safeParse(process.env);
if (!config.success) {
  console.error(
    "BLOCKED: configure the dedicated real Supabase staging spike environment; see docs/p0-setup.md.",
  );
  process.exit(1);
}
const env = config.data;
const runtime = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 5,
});
const migrator = postgres(env.MIGRATION_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 5,
});
const makeClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const first = makeClient(),
  second = makeClient();
const evidence: Record<string, boolean> = {};
let installedAccessor = false;
let stage = "preflight";
function requireProof(value: unknown): asserts value {
  if (!value) throw new Error("Spike assertion failed");
}
async function probe(token: string) {
  const { data, error } = await first.auth.getClaims(token);
  requireProof(!error && data?.claims);
  const claims = data.claims;
  requireProof(
    claims.iss === `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1` &&
      typeof claims.exp === "number" &&
      claims.exp > Math.floor(Date.now() / 1000) &&
      typeof claims.sub === "string" &&
      typeof claims.session_id === "string",
  );
  const [row] = await runtime<
    { original_created_at: Date; accepted: boolean }[]
  >`
    select * from app.spike_session_probe(${claims.session_id}::uuid,${claims.sub}::uuid,${env.SPIKE_ACCOUNT_ID}::uuid)`;
  requireProof(row);
  return { sessionId: claims.session_id, accepted: row.accepted };
}
try {
  const [role] = await runtime.unsafe(runtimeRoleSafetySql);
  requireProof(role?.safe);
  evidence.runtime_role_not_owner_or_bypass = true;
  // Install a narrow read-only accessor through the separate owner connection.
  const accessorSql = await readFile("db/spikes/session-probe.sql", "utf8");
  await migrator.begin(async (tx) => {
    await tx.unsafe(accessorSql);
  });
  installedAccessor = true;
  const email = `${env.SPIKE_ACCOUNT_ID}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`;
  stage = "normal_login";
  const initial = await first.auth.signInWithPassword({
    email,
    password: env.SPIKE_PASSWORD,
  });
  requireProof(!initial.error && initial.data.session);
  const initialProbe = await probe(initial.data.session.access_token);
  requireProof(initialProbe.accepted);
  evidence.normal_login = true;
  stage = "refresh_before_revoke";
  const refreshed = await first.auth.refreshSession({
    refresh_token: initial.data.session.refresh_token,
  });
  requireProof(!refreshed.error && refreshed.data.session);
  const refreshedProbe = await probe(refreshed.data.session.access_token);
  requireProof(
    refreshedProbe.accepted &&
      refreshedProbe.sessionId === initialProbe.sessionId,
  );
  evidence.same_original_session_after_refresh = true;
  stage = "advance_cutoff";
  await migrator.begin(async (tx) => {
    // Test harness administration: audit actor must be a real same-workspace RESPONSIBLE.
    const [actor] = await tx`select id,workspace_id from app.login_accounts
      where id=${env.SPIKE_ACTOR_ACCOUNT_ID}::uuid and role='RESPONSIBLE' and status='ACTIVE' for update`;
    requireProof(actor);
    const [target] =
      await tx`update app.login_accounts set revoked_before=clock_timestamp(),
      updated_at=clock_timestamp(),row_version=row_version+1
      where id=${env.SPIKE_ACCOUNT_ID}::uuid and workspace_id=${actor.workspace_id}::uuid
      returning workspace_id,person_id`;
    requireProof(target);
    await tx`insert into app.audit_events(workspace_id,actor_account_id,actor_role,subject_person_id,
      action,resource_type,resource_id,request_id,reason)
      values(${target.workspace_id}::uuid,${actor.id}::uuid,'RESPONSIBLE',${target.person_id}::uuid,
      'P0_SPIKE_REVOKE','login_account',${env.SPIKE_ACCOUNT_ID}::uuid,${randomUUID()}::uuid,
      'Dedicated P0 original-session invalidation acceptance experiment')`;
  });
  evidence.revoked_before_advanced = true;
  stage = "reject_old_refreshed_token";
  requireProof(!(await probe(refreshed.data.session.access_token)).accepted);
  evidence.refreshed_old_session_rejected = true;
  stage = "refresh_after_revoke";
  const late = await first.auth.refreshSession({
    refresh_token: refreshed.data.session.refresh_token,
  });
  requireProof(!late.error && late.data.session);
  const lateProbe = await probe(late.data.session.access_token);
  requireProof(
    lateProbe.sessionId === initialProbe.sessionId && !lateProbe.accepted,
  );
  evidence.refresh_after_revoke_still_rejected = true;
  stage = "new_login";
  const fresh = await second.auth.signInWithPassword({
    email,
    password: env.SPIKE_PASSWORD,
  });
  requireProof(!fresh.error && fresh.data.session);
  const freshProbe = await probe(fresh.data.session.access_token);
  requireProof(
    freshProbe.accepted && freshProbe.sessionId !== initialProbe.sessionId,
  );
  evidence.new_login_after_revoke_accepted = true;
  await mkdir("output/p0", { recursive: true });
  await writeFile(
    "output/p0/session-spike.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real Supabase original-session invalidation spike; sanitized evidence in output/p0/session-spike.json. This does not close P0.",
  );
} catch {
  await mkdir("output/p0", { recursive: true });
  await writeFile(
    "output/p0/session-spike.json",
    JSON.stringify({ result: "FAIL", stage, evidence }, null, 2),
  );
  console.error(
    `STOP AUTH SUBTASK: real session spike failed at ${stage}. Review sanitized evidence and propose the smallest supported alternative; no session platform fallback.`,
  );
  process.exitCode = 1;
} finally {
  // Best effort provider cleanup; never print provider errors or token material.
  await Promise.allSettled([
    first.auth.signOut({ scope: "local" }),
    second.auth.signOut({ scope: "local" }),
  ]);
  if (installedAccessor)
    await migrator
      .unsafe("DROP FUNCTION IF EXISTS app.spike_session_probe(uuid,uuid,uuid)")
      .catch(() => {
        console.error(
          "ACTION REQUIRED: remove the experimental spike_session_probe accessor with the migrator.",
        );
        process.exitCode = 1;
      });
  await Promise.all([runtime.end(), migrator.end()]);
}
