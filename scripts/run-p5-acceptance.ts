import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { z } from "zod";

const parsed = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    SUPABASE_SECRET_KEY: z.string().min(20),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    AUTH_INTERNAL_EMAIL_DOMAIN: z.string().min(4),
    HOSTED_ORIGIN: z.url().optional(),
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error("BLOCKED: P5 acceptance environment is incomplete.");
  process.exit(1);
}
const env = parsed.data,
  origin = env.HOSTED_ORIGIN ?? "https://tarbiyah-operations.vercel.app",
  admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }),
  publicClient = () =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  db = postgres(env.MIGRATION_DATABASE_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 8,
  });
const workspace = randomUUID(),
  outsiderWorkspace = randomUUID(),
  people = Array.from({ length: 4 }, () => randomUUID()),
  profile = randomUUID(),
  accounts = Array.from({ length: 4 }, () => randomUUID()),
  authIds: string[] = [],
  password = randomBytes(24).toString("base64url"),
  template = randomUUID(),
  cohort = randomUUID(),
  plan = randomUUID(),
  week = randomUUID(),
  group = randomUUID(),
  enrollment = randomUUID(),
  evidence: Record<string, boolean> = {};
let stage = "bootstrap";
function prove(value: unknown): asserts value {
  if (!value) throw new Error(`acceptance assertion failed: ${stage}`);
}
async function createIdentity(
  i: number,
  role: "RESPONSIBLE" | "MENTOR" | "STUDENT",
) {
  const created = await admin.auth.admin.createUser({
    email: `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  });
  prove(!created.error && created.data.user);
  authIds.push(created.data.user.id);
  await db`insert into app.login_accounts(id,workspace_id,person_id,supabase_auth_user_id,normalized_login_name,role,status,must_change_password) values(${accounts[i]}::uuid,${i === 3 ? outsiderWorkspace : workspace}::uuid,${people[i]}::uuid,${created.data.user.id}::uuid,${`p5_${accounts[i].replaceAll("-", "").slice(0, 12)}`},${role}::app.account_role,'ACTIVE',false)`;
}
async function login(i: number) {
  const signed = await publicClient().auth.signInWithPassword({
    email: `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    password,
  });
  prove(!signed.error && signed.data.session);
  return `__Host-tarbiyah-access=${signed.data.session.access_token}; __Host-tarbiyah-refresh=${signed.data.session.refresh_token}`;
}
async function request(
  cookie: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, result: await response.json() };
}
try {
  stage = "fixtures";
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P5 acceptance','Africa/Cairo',6),(${outsiderWorkspace}::uuid,'P5 isolated','Africa/Cairo',6)`;
    for (let i = 0; i < 4; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${people[i]}::uuid,${i === 3 ? outsiderWorkspace : workspace}::uuid,${`P5 Person ${i}`})`;
    await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${profile}::uuid,${workspace}::uuid,${people[2]}::uuid)`;
  });
  await createIdentity(0, "RESPONSIBLE");
  await createIdentity(1, "MENTOR");
  await createIdentity(2, "STUDENT");
  await createIdentity(3, "MENTOR");
  await db.begin(async (tx) => {
    await tx`insert into app.program_templates(id,workspace_id,name,level,status) values(${template}::uuid,${workspace}::uuid,'P5 template','L1','ACTIVE')`;
    await tx`insert into app.cohorts(id,workspace_id,name,source_template_id,starts_on,ends_on,status) values(${cohort}::uuid,${workspace}::uuid,'P5 cohort',${template}::uuid,current_date-30,current_date+30,'ACTIVE')`;
    await tx`insert into app.program_plans(id,workspace_id,cohort_id,version,name,status) values(${plan}::uuid,${workspace}::uuid,${cohort}::uuid,1,'P5 plan','PUBLISHED')`;
    await tx`update app.cohorts set current_plan_id=${plan}::uuid where id=${cohort}::uuid`;
    await tx`insert into app.plan_weeks(id,workspace_id,plan_id,week_number,week_type,title) values(${week}::uuid,${workspace}::uuid,${plan}::uuid,1,'STANDARD','P5 week')`;
    await tx`insert into app.groups(id,workspace_id,cohort_id,name) values(${group}::uuid,${workspace}::uuid,${cohort}::uuid,'P5 group')`;
    await tx`insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from) values(${enrollment}::uuid,${workspace}::uuid,${profile}::uuid,${cohort}::uuid,clock_timestamp()-interval '20 days')`;
    await tx`insert into app.group_memberships(workspace_id,enrollment_id,group_id,effective_from) values(${workspace}::uuid,${enrollment}::uuid,${group}::uuid,clock_timestamp()-interval '20 days')`;
    await tx`insert into app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from) values(${workspace}::uuid,${group}::uuid,${people[1]}::uuid,clock_timestamp()-interval '20 days')`;
    for (let i = 0; i < 2; i++) {
      const definition = randomUUID(),
        occurrence = randomUUID(),
        roster = randomUUID();
      await tx`insert into app.session_definitions(id,workspace_id,plan_week_id,name,session_type,day_offset,starts_at,duration_minutes,attendance_required) values(${definition}::uuid,${workspace}::uuid,${week}::uuid,${`P5 session ${i}`},'GROUP',${i},'10:00',60,true)`;
      await tx`insert into app.session_occurrences(id,workspace_id,session_definition_id,group_id,starts_at,ends_at,status) values(${occurrence}::uuid,${workspace}::uuid,${definition}::uuid,${group}::uuid,clock_timestamp()-(${4 - i}||' days')::interval,clock_timestamp()-(${4 - i}||' days')::interval+interval '1 hour','OPEN')`;
      await tx`insert into app.session_roster(id,workspace_id,session_occurrence_id,enrollment_id) values(${roster}::uuid,${workspace}::uuid,${occurrence}::uuid,${enrollment}::uuid)`;
      await tx`insert into app.attendance(workspace_id,roster_id,status,reason) values(${workspace}::uuid,${roster}::uuid,'UNEXCUSED_ABSENCE','غياب دون عذر')`;
    }
    await tx`insert into app.exam_definitions(workspace_id,plan_week_id,title,day_offset,max_score) values(${workspace}::uuid,${week}::uuid,'P5 overdue exam',0,20)`;
    await tx`insert into app.assignment_definitions(workspace_id,plan_week_id,title,instructions,due_day_offset,max_score) values(${workspace}::uuid,${week}::uuid,'P5 overdue review','أرسل التكليف للمراجعة',0,20)`;
  });
  const mentor = await login(1),
    student = await login(2),
    outsider = await login(3);
  stage = "rules_and_dedup";
  let response = await request(
    mentor,
    "/api/v1/attention/evaluate",
    "POST",
    {},
  );
  prove(response.status === 200 && response.result.created >= 6);
  response = await request(mentor, "/api/v1/attention/evaluate", "POST", {});
  prove(response.status === 200 && response.result.created === 0);
  let list = await request(mentor, "/api/v1/attention");
  const codes = new Set(
    list.result.attentions.map((x: { rule_code: string }) => x.rule_code),
  );
  prove(
    [
      "CONSECUTIVE_UNEXCUSED_ABSENCE",
      "NO_QUALIFIED_FOLLOWUP_14D",
      "NEW_STUDENT_NO_CHECKIN_3D",
      "SESSION_OVERDUE_24H",
      "EXAM_OR_REVIEW_OVERDUE",
    ].every((code) => codes.has(code)),
  );
  prove(
    list.result.attentions.every(
      (item: { owner_account_id: string }) =>
        item.owner_account_id === accounts[1],
    ),
  );
  prove(
    list.result.attentions.filter(
      (item: { rule_code: string }) =>
        item.rule_code === "EXAM_OR_REVIEW_OVERDUE",
    ).length === 2,
  );
  evidence.six_rule_engine_and_dedup = true;
  const first = list.result.attentions.find(
    (item: { rule_code: string }) =>
      item.rule_code === "NO_QUALIFIED_FOLLOWUP_14D",
  );
  stage = "attention_lifecycle";
  response = await request(
    mentor,
    `/api/v1/attention/${first.id}/claim`,
    "POST",
    { row_version: first.row_version },
  );
  prove(response.status === 200 && response.result.status === "IN_PROGRESS");
  response = await request(
    mentor,
    `/api/v1/attention/${first.id}/snooze`,
    "POST",
    {
      row_version: response.result.row_version,
      until: new Date(Date.now() + 86400000).toISOString(),
    },
  );
  prove(response.status === 200 && response.result.status === "SNOOZED");
  response = await request(
    mentor,
    `/api/v1/attention/${first.id}/claim`,
    "POST",
    { row_version: response.result.row_version },
  );
  response = await request(
    mentor,
    `/api/v1/students/${profile}/followups`,
    "POST",
    {
      enrollment_id: enrollment,
      occurred_at: new Date(Date.now() - 3600000).toISOString(),
      channel: "PHONE",
      outcome: "تم الاتفاق على خطوات عملية",
      qualifies: true,
      action_id: null,
      case_id: null,
    },
  );
  prove(response.status === 200);
  const followupId = response.result.id;
  response = await request(
    mentor,
    `/api/v1/attention/${first.id}/resolve`,
    "POST",
    {
      row_version: response.result.row_version,
      reason: "زوال سبب التنبيه بعد التحقق",
    },
  );
  prove(response.status === 200 && response.result.status === "RESOLVED");
  const second = list.result.attentions.find(
    (item: { id: string }) => item.id !== first.id,
  );
  response = await request(
    mentor,
    `/api/v1/attention/${second.id}/dismiss`,
    "POST",
    { row_version: second.row_version, reason: "دليل غير منطبق على الحالة" },
  );
  prove(response.status === 200);
  evidence.attention_lifecycle = true;
  stage = "manual_case_and_case_rule";
  response = await request(mentor, "/api/v1/cases", "POST", {
    enrollment_id: enrollment,
    title: "حالة متابعة الغياب",
    problem: "غياب متكرر يحتاج خطة متابعة",
    priority: "HIGH",
    owner_account_id: accounts[1],
  });
  prove(response.status === 200);
  const caseId = response.result.id;
  response = await request(mentor, "/api/v1/attention/evaluate", "POST", {});
  prove(response.status === 200 && response.result.created >= 1);
  evidence.case_manual_and_missing_action_signal = true;
  stage = "action_verification";
  response = await request(mentor, "/api/v1/actions", "POST", {
    enrollment_id: enrollment,
    attention_id: null,
    case_id: caseId,
    owner_account_id: accounts[1],
    title: "التواصل والتحقق من خطة الحضور",
    due_at: new Date(Date.now() + 86400000).toISOString(),
  });
  prove(response.status === 200);
  const actionId = response.result.id;
  response = await request(
    mentor,
    `/api/v1/actions/${actionId}/start`,
    "POST",
    { row_version: 1 },
  );
  response = await request(
    mentor,
    `/api/v1/actions/${actionId}/complete`,
    "POST",
    { row_version: 2, note: "تم التواصل وتحديد الخطة" },
  );
  prove(response.result.status === "DONE_PENDING_VERIFICATION");
  response = await request(
    mentor,
    `/api/v1/actions/${actionId}/verify`,
    "POST",
    { row_version: 3, note: "تم التحقق من التزام الطالب بالخطة" },
  );
  prove(response.status === 200 && response.result.status === "VERIFIED");
  evidence.action_requires_verification = true;
  stage = "followup_history";
  response = await request(
    mentor,
    `/api/v1/followups/${followupId}/corrections`,
    "POST",
    {
      row_version: 1,
      occurred_at: new Date(Date.now() - 3500000).toISOString(),
      channel: "PHONE",
      outcome: "تم الاتفاق والتحقق من فهم الخطوات",
      qualifies: true,
      cancel: false,
      reason: "استكمال وصف النتيجة",
    },
  );
  prove(response.status === 200 && response.result.version === 2);
  const revisions =
    await db`select count(*) count from app.followup_revisions where followup_id=${followupId}::uuid`;
  prove(Number(revisions[0].count) === 1);
  evidence.followup_immutable_correction = true;
  stage = "case_resolution";
  response = await request(mentor, `/api/v1/cases/${caseId}/escalate`, "POST", {
    row_version: 1,
    note: "تصعيد للمتابعة المكثفة",
    priority: "CRITICAL",
  });
  prove(response.status === 200);
  response = await request(mentor, `/api/v1/cases/${caseId}/resolve`, "POST", {
    row_version: 2,
    note: "تحققت النتيجة عبر الإجراء والمتابعة",
  });
  prove(response.status === 200 && response.result.status === "RESOLVED");
  evidence.case_verified_resolution = true;
  stage = "privacy_and_isolation";
  response = await request(student, "/api/v1/attention");
  prove(response.status === 403);
  response = await request(outsider, "/api/v1/attention");
  prove(response.status === 200 && response.result.attentions.length === 0);
  evidence.student_private_and_cross_workspace_denied = true;
  stage = "audit";
  const audits =
    await db`select count(*) count from app.audit_events where workspace_id=${workspace}::uuid and action like any(array['ATTENTION_%','ACTION_%','FOLLOWUP_%','CASE_%'])`;
  prove(Number(audits[0].count) >= 12);
  evidence.atomic_audit = true;
  await mkdir("output/p5", { recursive: true });
  await writeFile(
    "output/p5/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: hosted P5 attention, actions, followups, cases, verification, privacy and cleanup completed.",
  );
} catch (error) {
  await mkdir("output/p5", { recursive: true });
  await writeFile(
    "output/p5/acceptance.json",
    JSON.stringify({ result: "FAIL", stage, evidence }, null, 2),
  );
  console.error(`P5 acceptance failed at ${stage}.`);
  process.exitCode = 1;
} finally {
  try {
    await db.begin(async (tx) => {
      await tx`alter table app.followup_revisions disable trigger followup_revision_immutable`;
      await tx`alter table app.case_events disable trigger case_event_immutable`;
      await tx`alter table app.audit_events disable trigger audit_immutable`;
      await tx`delete from app.case_events where workspace_id=${workspace}::uuid`;
      await tx`delete from app.followup_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.followups where workspace_id=${workspace}::uuid`;
      await tx`delete from app.actions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.attentions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cases where workspace_id=${workspace}::uuid`;
      await tx`delete from app.audit_events where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.attendance where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_roster where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_occurrences where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.exam_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.group_memberships where workspace_id=${workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where id=${cohort}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${workspace}::uuid`;
      await tx`delete from app.login_accounts where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.student_profiles where workspace_id=${workspace}::uuid`;
      await tx`delete from app.persons where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.workspaces where id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`alter table app.followup_revisions enable trigger followup_revision_immutable`;
      await tx`alter table app.case_events enable trigger case_event_immutable`;
      await tx`alter table app.audit_events enable trigger audit_immutable`;
    });
    for (const authId of authIds) await admin.auth.admin.deleteUser(authId);
  } catch {
    console.error("ACTION REQUIRED: P5 fixture cleanup failed safely.");
    process.exitCode = 1;
  }
  await db.end();
}
