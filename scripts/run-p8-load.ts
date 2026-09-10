import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { z } from "zod";

const parsed = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
    SUPABASE_SECRET_KEY: z.string().min(20),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    AUTH_INTERNAL_EMAIL_DOMAIN: z.string().min(4),
    HOSTED_ORIGIN: z.url().optional(),
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error("BLOCKED: P8 load environment is incomplete.");
  process.exit(1);
}

const env = parsed.data;
const origin = env.HOSTED_ORIGIN ?? "https://tarbiyah-operations.vercel.app";
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const db = postgres(env.MIGRATION_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 8,
});
const workspace = randomUUID();
const responsiblePerson = randomUUID();
const mentorPeople = Array.from({ length: 10 }, () => randomUUID());
const studentPeople = Array.from({ length: 200 }, () => randomUUID());
const studentProfiles = Array.from({ length: 200 }, () => randomUUID());
const enrollments = Array.from({ length: 200 }, () => randomUUID());
const groups = Array.from({ length: 10 }, () => randomUUID());
const template = randomUUID();
const cohort = randomUUID();
const plan = randomUUID();
const weeks = Array.from({ length: 12 }, () => randomUUID());
const password = randomBytes(24).toString("base64url");
const authIds: string[] = [];
const identities = [
  { role: "RESPONSIBLE" as const, personId: responsiblePerson },
  ...mentorPeople.map((personId) => ({ role: "MENTOR" as const, personId })),
  ...studentPeople.slice(0, 9).map((personId) => ({
    role: "STUDENT" as const,
    personId,
  })),
].map((item) => ({ ...item, accountId: randomUUID() }));
type SafeResult = {
  role?: string;
  code?: string;
  request_id?: string;
};
const report: {
  result: "PASS" | "FAIL";
  at: string;
  fixture: Record<string, number>;
  measurements: Record<string, number>;
  evidence: Record<string, boolean>;
  failing_stage?: string;
  http?: { status: number; code?: string; request_id?: string };
  diagnostic?: string;
} = {
  result: "FAIL",
  at: new Date().toISOString(),
  fixture: { students: 200, mentors: 10, weeks: 12, concurrent_users: 20 },
  measurements: {},
  evidence: {},
};
let stage = "bootstrap";
let lastHttp:
  { status: number; code?: string; request_id?: string } | undefined;

function prove(value: unknown, message = stage): asserts value {
  if (!value) throw new Error(message);
}

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

async function timedRead(path: string, cookie: string, expectedRole: string) {
  const started = performance.now();
  const response = await fetch(`${origin}${path}`, {
    headers: { Cookie: cookie, Origin: origin },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const duration = performance.now() - started;
  const body = (await response.json()) as SafeResult;
  lastHttp = {
    status: response.status,
    code: body.code,
    request_id: body.request_id,
  };
  prove(
    response.status === 200 && body.role === expectedRole,
    "load request failed",
  );
  return duration;
}

try {
  stage = "reference_fixture";
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P8 load fixture','Africa/Cairo',6)`;
    await tx`insert into app.persons(id,workspace_id,display_name) values(${responsiblePerson}::uuid,${workspace}::uuid,'P8 Responsible')`;
    for (let i = 0; i < mentorPeople.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${mentorPeople[i]}::uuid,${workspace}::uuid,${`P8 Mentor ${i + 1}`})`;
    for (let i = 0; i < studentPeople.length; i++) {
      await tx`insert into app.persons(id,workspace_id,display_name) values(${studentPeople[i]}::uuid,${workspace}::uuid,${`P8 Student ${i + 1}`})`;
      await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${studentProfiles[i]}::uuid,${workspace}::uuid,${studentPeople[i]}::uuid)`;
    }
    await tx`insert into app.program_templates(id,workspace_id,name,level,status) values(${template}::uuid,${workspace}::uuid,'P8 reference program','L1','ACTIVE')`;
    await tx`insert into app.cohorts(id,workspace_id,name,source_template_id,starts_on,ends_on,status) values(${cohort}::uuid,${workspace}::uuid,'P8 reference cohort',${template}::uuid,current_date-14,current_date+100,'ACTIVE')`;
    await tx`insert into app.program_plans(id,workspace_id,cohort_id,version,name,status) values(${plan}::uuid,${workspace}::uuid,${cohort}::uuid,1,'P8 reference plan','DRAFT')`;
    for (let i = 0; i < weeks.length; i++)
      await tx`insert into app.plan_weeks(id,workspace_id,plan_id,week_number,week_type,title) values(${weeks[i]}::uuid,${workspace}::uuid,${plan}::uuid,${i + 1},'STANDARD',${`P8 Week ${i + 1}`})`;
    for (let i = 0; i < groups.length; i++)
      await tx`insert into app.groups(id,workspace_id,cohort_id,name) values(${groups[i]}::uuid,${workspace}::uuid,${cohort}::uuid,${`P8 Group ${i + 1}`})`;
    for (let i = 0; i < studentPeople.length; i++) {
      await tx`insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from) values(${enrollments[i]}::uuid,${workspace}::uuid,${studentProfiles[i]}::uuid,${cohort}::uuid,clock_timestamp()-interval '14 days')`;
      await tx`insert into app.group_memberships(workspace_id,enrollment_id,group_id,effective_from) values(${workspace}::uuid,${enrollments[i]}::uuid,${groups[i % 10]}::uuid,clock_timestamp()-interval '14 days')`;
    }
    for (let i = 0; i < mentorPeople.length; i++)
      await tx`insert into app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from) values(${workspace}::uuid,${groups[i]}::uuid,${mentorPeople[i]}::uuid,clock_timestamp()-interval '14 days')`;
    await tx`update app.program_plans set status='PUBLISHED' where id=${plan}::uuid`;
    await tx`update app.cohorts set current_plan_id=${plan}::uuid where id=${cohort}::uuid`;
  });
  const fixtureCounts = await db<
    { students: number; mentors: number; weeks: number }[]
  >`
    select
      (select count(*)::int from app.student_profiles where workspace_id=${workspace}::uuid) students,
      (select count(*)::int from app.mentor_assignments where workspace_id=${workspace}::uuid) mentors,
      (select count(*)::int from app.plan_weeks where workspace_id=${workspace}::uuid) weeks`;
  const counts = fixtureCounts[0];
  prove(
    counts?.students === 200 && counts.mentors === 10 && counts.weeks === 12,
  );
  report.evidence.reference_fixture_exact = true;
  report.evidence.students_without_accounts_supported = true;

  stage = "twenty_authenticated_users";
  const sessions: { role: string; cookie: string }[] = [];
  for (let i = 0; i < identities.length; i++) {
    const identity = identities[i];
    const loginName = `p8_${identity.accountId.replaceAll("-", "").slice(0, 18)}`;
    const email = `${identity.accountId}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    prove(!created.error && created.data.user);
    authIds.push(created.data.user.id);
    await db`insert into app.login_accounts(id,workspace_id,person_id,supabase_auth_user_id,normalized_login_name,role,status,must_change_password)
      values(${identity.accountId}::uuid,${workspace}::uuid,${identity.personId}::uuid,${created.data.user.id}::uuid,${loginName},${identity.role}::app.account_role,'ACTIVE',false)`;
    const client = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const signed = await client.auth.signInWithPassword({ email, password });
    prove(!signed.error && signed.data.session?.access_token);
    sessions.push({
      role: identity.role,
      cookie: `__Host-tarbiyah-access=${encodeURIComponent(signed.data.session.access_token)}`,
    });
  }
  prove(sessions.length === 20);
  report.evidence.twenty_distinct_authenticated_users = true;

  stage = "cold_start_measurement";
  const coldStarted = performance.now();
  const cold = await fetch(`${origin}/ready`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  report.measurements.cold_ready_ms =
    Math.round((performance.now() - coldStarted) * 10) / 10;
  prove(cold.status === 200);
  report.evidence.cold_start_reported_separately = true;

  stage = "warmup";
  await Promise.all(
    sessions.map((session) =>
      timedRead("/api/v1/me", session.cookie, session.role),
    ),
  );

  stage = "reference_load";
  const durations: number[] = [];
  const paths = [
    "/api/v1/me/today",
    "/api/v1/me/program",
    "/api/v1/me/progress",
  ];
  for (let round = 0; round < 5; round++) {
    const measured = await Promise.all(
      sessions.flatMap((session) =>
        paths.map((path) => timedRead(path, session.cookie, session.role)),
      ),
    );
    durations.push(...measured);
  }
  report.measurements.requests = durations.length;
  report.measurements.p50_ms = Math.round(percentile(durations, 0.5) * 10) / 10;
  report.measurements.p95_ms =
    Math.round(percentile(durations, 0.95) * 10) / 10;
  report.measurements.max_ms = Math.round(Math.max(...durations) * 10) / 10;
  prove(durations.length === 300);
  prove(
    report.measurements.p95_ms < 1000,
    "operational read P95 exceeded 1000ms",
  );
  report.evidence.all_reference_requests_succeeded = true;
  report.evidence.operational_read_p95_below_1000ms = true;
  report.result = "PASS";
  console.log(
    `PASS: P8 reference load completed; P95 ${report.measurements.p95_ms}ms across ${durations.length} reads.`,
  );
} catch (error) {
  report.failing_stage = stage;
  report.http = lastHttp;
  report.diagnostic = error instanceof Error ? error.message : "UnknownError";
  console.error(`FAIL: P8 load check failed at ${stage}.`);
  process.exitCode = 1;
} finally {
  try {
    await db.begin(async (tx) => {
      await tx`alter table app.audit_events disable trigger audit_immutable`;
      await tx`alter table app.plan_weeks disable trigger week_requires_draft_plan`;
      await tx`alter table app.program_plans disable trigger plan_immutable`;
      await tx`delete from app.audit_events where workspace_id=${workspace}::uuid`;
      await tx`delete from app.idempotency_records where workspace_id=${workspace}::uuid`;
      await tx`delete from app.group_memberships where workspace_id=${workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where workspace_id=${workspace}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${workspace}::uuid`;
      await tx`delete from app.login_accounts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_profiles where workspace_id=${workspace}::uuid`;
      await tx`delete from app.persons where workspace_id=${workspace}::uuid`;
      await tx`delete from app.workspaces where id=${workspace}::uuid`;
      await tx`alter table app.audit_events enable trigger audit_immutable`;
      await tx`alter table app.plan_weeks enable trigger week_requires_draft_plan`;
      await tx`alter table app.program_plans enable trigger plan_immutable`;
    });
    for (const authId of authIds) await admin.auth.admin.deleteUser(authId);
    report.evidence.fixture_cleanup = true;
  } catch {
    report.result = "FAIL";
    report.diagnostic = "fixture cleanup failed";
    console.error("ACTION REQUIRED: P8 load fixture cleanup failed safely.");
    process.exitCode = 1;
  }
  await mkdir("output/p8", { recursive: true });
  await writeFile("output/p8/load.json", JSON.stringify(report, null, 2));
  await db.end();
}
