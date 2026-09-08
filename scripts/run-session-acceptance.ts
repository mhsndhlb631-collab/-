import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { z } from "zod";
import { deriveRuntimeDatabaseUrl } from "../src/server/runtime-url.ts";

const parsed = z
  .object({
    APP_ENV: z.literal("staging"),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
    SUPABASE_SECRET_KEY: z.string().min(10),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    RUNTIME_DATABASE_PASSWORD: z.string().min(24),
    AUTH_INTERNAL_EMAIL_DOMAIN: z.string().min(4),
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error("BLOCKED: real session acceptance environment is incomplete.");
  process.exit(1);
}
const env = parsed.data;
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const publicClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const migrator = postgres(env.MIGRATION_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 5,
});
const runtime = postgres(
  deriveRuntimeDatabaseUrl({
    migrationUrl: env.MIGRATION_DATABASE_URL,
    runtimePassword: env.RUNTIME_DATABASE_PASSWORD,
  }),
  { prepare: false, max: 1, connect_timeout: 5 },
);

const fixture = {
  workspaceId: randomUUID(),
  responsiblePersonId: randomUUID(),
  responsibleAccountId: randomUUID(),
  studentPersonId: randomUUID(),
  studentProfileId: randomUUID(),
  studentAccountId: randomUUID(),
};
const createdAuthIds: string[] = [];
const password = randomBytes(24).toString("base64url");
const evidence: Record<string, boolean> = {};
let stage = "bootstrap";
let accessorInstalled = false;
function requireProof(value: unknown): asserts value {
  if (!value) throw new Error("acceptance assertion failed");
}

async function createLinkedIdentity(
  accountId: string,
  role: "RESPONSIBLE" | "STUDENT",
) {
  const email = `${accountId}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ban_duration: "876000h",
  });
  requireProof(!created.error && created.data.user);
  createdAuthIds.push(created.data.user.id);
  const personId =
    role === "RESPONSIBLE"
      ? fixture.responsiblePersonId
      : fixture.studentPersonId;
  await migrator`update app.login_accounts set supabase_auth_user_id=${created.data.user.id}::uuid,
    updated_at=clock_timestamp(),row_version=row_version+1
    where id=${accountId}::uuid and person_id=${personId}::uuid and status='PROVISIONING'`;
  const activated = await admin.auth.admin.updateUserById(
    created.data.user.id,
    { ban_duration: "none" },
  );
  requireProof(!activated.error);
  await migrator`update app.login_accounts set status='ACTIVE',must_change_password=false,
    temporary_password_expires_at=null,updated_at=clock_timestamp(),row_version=row_version+1
    where id=${accountId}::uuid and supabase_auth_user_id=${created.data.user.id}::uuid and status='PROVISIONING'`;
  return email;
}

async function accepted(accessToken: string, accountId: string) {
  const verifier = publicClient();
  const claimsResult = await verifier.auth.getClaims(accessToken);
  requireProof(!claimsResult.error && claimsResult.data?.claims);
  const claims = claimsResult.data.claims;
  requireProof(
    claims.iss === `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1` &&
      typeof claims.exp === "number" &&
      claims.exp > Math.floor(Date.now() / 1000) &&
      typeof claims.sub === "string" &&
      typeof claims.session_id === "string",
  );
  return runtime.begin(async (tx) => {
    await tx.unsafe("set local role tarbiyah_runtime");
    const [row] = await tx<{ original_created_at: Date; accepted: boolean }[]>`
      select * from app.spike_session_probe(${claims.session_id}::uuid,${claims.sub}::uuid,${accountId}::uuid)`;
    requireProof(row);
    return { sessionId: String(claims.session_id), accepted: row.accepted };
  });
}

try {
  await migrator.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on)
      values(${fixture.workspaceId}::uuid,'P0 temporary acceptance','Africa/Cairo',6)`;
    await tx`insert into app.persons(id,workspace_id,display_name) values
      (${fixture.responsiblePersonId}::uuid,${fixture.workspaceId}::uuid,'P0 Responsible'),
      (${fixture.studentPersonId}::uuid,${fixture.workspaceId}::uuid,'P0 Student')`;
    await tx`insert into app.student_profiles(id,workspace_id,person_id)
      values(${fixture.studentProfileId}::uuid,${fixture.workspaceId}::uuid,${fixture.studentPersonId}::uuid)`;
    await tx`insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role)
      values(${fixture.responsibleAccountId}::uuid,${fixture.workspaceId}::uuid,${fixture.responsiblePersonId}::uuid,
        ${`p0_admin_${fixture.responsibleAccountId.slice(0, 8)}`} ,'RESPONSIBLE'),
        (${fixture.studentAccountId}::uuid,${fixture.workspaceId}::uuid,${fixture.studentPersonId}::uuid,
        ${`p0_student_${fixture.studentAccountId.slice(0, 8)}`} ,'STUDENT')`;
  });
  const responsibleEmail = await createLinkedIdentity(
    fixture.responsibleAccountId,
    "RESPONSIBLE",
  );
  const studentEmail = await createLinkedIdentity(
    fixture.studentAccountId,
    "STUDENT",
  );
  requireProof(responsibleEmail !== studentEmail);
  evidence.disabled_create_link_activate_sequence = true;

  const accessorSql = await readFile("db/spikes/session-probe.sql", "utf8");
  await migrator.begin(async (tx) => {
    await tx.unsafe(accessorSql);
  });
  accessorInstalled = true;

  const first = publicClient();
  stage = "normal_login";
  const initial = await first.auth.signInWithPassword({
    email: studentEmail,
    password,
  });
  requireProof(!initial.error && initial.data.session);
  const firstProbe = await accepted(
    initial.data.session.access_token,
    fixture.studentAccountId,
  );
  requireProof(firstProbe.accepted);
  evidence.normal_login = true;

  stage = "refresh_before_revocation";
  const refreshed = await first.auth.refreshSession({
    refresh_token: initial.data.session.refresh_token,
  });
  requireProof(!refreshed.error && refreshed.data.session);
  const refreshedProbe = await accepted(
    refreshed.data.session.access_token,
    fixture.studentAccountId,
  );
  requireProof(
    refreshedProbe.accepted &&
      refreshedProbe.sessionId === firstProbe.sessionId,
  );
  evidence.refresh_preserves_original_session = true;

  stage = "revoke";
  await migrator.begin(async (tx) => {
    const [target] =
      await tx`update app.login_accounts set revoked_before=clock_timestamp(),
      updated_at=clock_timestamp(),row_version=row_version+1 where id=${fixture.studentAccountId}::uuid returning person_id`;
    requireProof(target);
    await tx`insert into app.audit_events(workspace_id,actor_account_id,actor_role,subject_person_id,
      action,resource_type,resource_id,request_id,reason) values(${fixture.workspaceId}::uuid,
      ${fixture.responsibleAccountId}::uuid,'RESPONSIBLE',${target.person_id}::uuid,'P0_SPIKE_REVOKE',
      'login_account',${fixture.studentAccountId}::uuid,${randomUUID()}::uuid,'Temporary P0 acceptance')`;
  });
  evidence.revoked_before_advanced_and_audited = true;
  requireProof(
    !(
      await accepted(
        refreshed.data.session.access_token,
        fixture.studentAccountId,
      )
    ).accepted,
  );
  evidence.refreshed_pre_revocation_token_rejected = true;

  stage = "refresh_after_revocation";
  const late = await first.auth.refreshSession({
    refresh_token: refreshed.data.session.refresh_token,
  });
  requireProof(!late.error && late.data.session);
  const lateProbe = await accepted(
    late.data.session.access_token,
    fixture.studentAccountId,
  );
  requireProof(
    lateProbe.sessionId === firstProbe.sessionId && !lateProbe.accepted,
  );
  evidence.refresh_after_revocation_still_rejected = true;

  stage = "new_login";
  const second = publicClient();
  const fresh = await second.auth.signInWithPassword({
    email: studentEmail,
    password,
  });
  requireProof(!fresh.error && fresh.data.session);
  const freshProbe = await accepted(
    fresh.data.session.access_token,
    fixture.studentAccountId,
  );
  requireProof(
    freshProbe.accepted && freshProbe.sessionId !== firstProbe.sessionId,
  );
  evidence.new_login_after_revocation_accepted = true;
  await Promise.allSettled([
    first.auth.signOut({ scope: "local" }),
    second.auth.signOut({ scope: "local" }),
  ]);

  await mkdir("output/p0", { recursive: true });
  await writeFile(
    "output/p0/session-acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real Supabase login, refresh, revocation and new-login acceptance completed; sanitized evidence saved.",
  );
} catch {
  await mkdir("output/p0", { recursive: true });
  await writeFile(
    "output/p0/session-acceptance.json",
    JSON.stringify({ result: "FAIL", stage, evidence }, null, 2),
  );
  console.error(
    `STOP AUTH SUBTASK: real acceptance failed at ${stage}; sanitized evidence saved, no secrets printed.`,
  );
  process.exitCode = 1;
} finally {
  if (accessorInstalled)
    await migrator
      .unsafe("drop function if exists app.spike_session_probe(uuid,uuid,uuid)")
      .catch(() => {});
  for (const id of createdAuthIds)
    await admin.auth.admin.deleteUser(id).catch(() => {});
  await migrator
    .begin(async (tx) => {
      await tx.unsafe(
        "alter table app.audit_events disable trigger audit_immutable",
      );
      await tx`delete from app.audit_events where workspace_id=${fixture.workspaceId}::uuid`;
      await tx.unsafe(
        "alter table app.audit_events enable trigger audit_immutable",
      );
      await tx`delete from app.login_accounts where workspace_id=${fixture.workspaceId}::uuid`;
      await tx`delete from app.student_profiles where workspace_id=${fixture.workspaceId}::uuid`;
      await tx`delete from app.persons where workspace_id=${fixture.workspaceId}::uuid`;
      await tx`delete from app.workspaces where id=${fixture.workspaceId}::uuid`;
    })
    .catch(() => {
      console.error(
        "ACTION REQUIRED: temporary fixture cleanup did not complete.",
      );
      process.exitCode = 1;
    });
  await Promise.all([runtime.end(), migrator.end()]);
}
