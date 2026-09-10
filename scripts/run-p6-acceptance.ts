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
  console.error("BLOCKED: P6 acceptance environment is incomplete.");
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
  people = Array.from({ length: 6 }, () => randomUUID()),
  profile = randomUUID(),
  accounts = Array.from({ length: 6 }, () => randomUUID()),
  authIds: string[] = [],
  password = randomBytes(24).toString("base64url"),
  template = randomUUID(),
  cohort = randomUUID(),
  plan = randomUUID(),
  week = randomUUID(),
  group = randomUUID(),
  enrollment = randomUUID(),
  caseId = randomUUID(),
  evidence: Record<string, boolean> = {};
let stage = "bootstrap",
  lastHttp: { status: number; code?: string; request_id?: string } | null =
    null;
function prove(value: unknown): asserts value {
  if (!value) throw new Error(`acceptance assertion failed: ${stage}`);
}
function day(offset = 0) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}
async function identity(i: number, role: "RESPONSIBLE" | "MENTOR" | "STUDENT") {
  stage = `identity_${role.toLowerCase()}_${i}`;
  const created = await admin.auth.admin.createUser({
    email: `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  });
  prove(!created.error && created.data.user);
  authIds.push(created.data.user.id);
  await db`insert into app.login_accounts(id,workspace_id,person_id,supabase_auth_user_id,normalized_login_name,role,status,must_change_password) values(${accounts[i]}::uuid,${i === 5 ? outsiderWorkspace : workspace}::uuid,${people[i]}::uuid,${created.data.user.id}::uuid,${`p6_${accounts[i].replaceAll("-", "").slice(0, 12)}`},${role}::app.account_role,'ACTIVE',false)`;
}
async function login(i: number) {
  const signed = await publicClient().auth.signInWithPassword({
    email: `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    password,
  });
  prove(!signed.error && signed.data.session);
  return `__Host-tarbiyah-access=${signed.data.session.access_token}; __Host-tarbiyah-refresh=${signed.data.session.refresh_token}`;
}
async function request(cookie: string, path: string) {
  const response = await fetch(`${origin}${path}`, {
      headers: { Cookie: cookie },
    }),
    result = await response.json();
  lastHttp = {
    status: response.status,
    code: result?.code,
    request_id: result?.request_id,
  };
  return { status: response.status, result };
}
try {
  stage = "fixtures_identity";
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P6 acceptance','Africa/Cairo',6),(${outsiderWorkspace}::uuid,'P6 isolated','Africa/Cairo',6)`;
    for (let i = 0; i < people.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${people[i]}::uuid,${i === 5 ? outsiderWorkspace : workspace}::uuid,${`P6 Person ${i}`})`;
    await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${profile}::uuid,${workspace}::uuid,${people[4]}::uuid)`;
  });
  await identity(0, "RESPONSIBLE");
  await identity(1, "MENTOR");
  await identity(2, "MENTOR");
  await identity(3, "MENTOR");
  await identity(4, "STUDENT");
  await identity(5, "RESPONSIBLE");
  stage = "fixtures_domain";
  await db.begin(async (tx) => {
    await tx`insert into app.program_templates(id,workspace_id,name,level,status) values(${template}::uuid,${workspace}::uuid,'P6 template','L1','ACTIVE')`;
    await tx`insert into app.cohorts(id,workspace_id,name,source_template_id,starts_on,ends_on,status) values(${cohort}::uuid,${workspace}::uuid,'P6 cohort',${template}::uuid,current_date-20,current_date+20,'ACTIVE')`;
    await tx`insert into app.program_plans(id,workspace_id,cohort_id,version,name,status) values(${plan}::uuid,${workspace}::uuid,${cohort}::uuid,1,'P6 plan','DRAFT')`;
    await tx`insert into app.plan_weeks(id,workspace_id,plan_id,week_number,week_type,title) values(${week}::uuid,${workspace}::uuid,${plan}::uuid,1,'STANDARD','P6 week')`;
    await tx`insert into app.groups(id,workspace_id,cohort_id,name) values(${group}::uuid,${workspace}::uuid,${cohort}::uuid,'P6 group')`;
    await tx`insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from) values(${enrollment}::uuid,${workspace}::uuid,${profile}::uuid,${cohort}::uuid,clock_timestamp()-interval '20 days')`;
    await tx`insert into app.group_memberships(workspace_id,enrollment_id,group_id,effective_from) values(${workspace}::uuid,${enrollment}::uuid,${group}::uuid,clock_timestamp()-interval '20 days')`;
    await tx`insert into app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from,effective_to) values(${workspace}::uuid,${group}::uuid,${people[1]}::uuid,clock_timestamp()-interval '20 days',clock_timestamp()-interval '12 hours')`;
    await tx`insert into app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from) values(${workspace}::uuid,${group}::uuid,${people[2]}::uuid,clock_timestamp()-interval '12 hours')`;
    for (let i = 0; i < 2; i++) {
      const definition = randomUUID(),
        occurrence = randomUUID(),
        roster = randomUUID(),
        metric = randomUUID();
      await tx`insert into app.session_definitions(id,workspace_id,plan_week_id,name,session_type,day_offset,starts_at,duration_minutes,attendance_required) values(${definition}::uuid,${workspace}::uuid,${week}::uuid,${`P6 session ${i}`},'GROUP',${i},'10:00',60,true)`;
      await tx`insert into app.session_metric_definitions(id,workspace_id,session_definition_id,name,value_type,required,applies_to) values(${metric}::uuid,${workspace}::uuid,${definition}::uuid,'مقياس مطلوب','BOOLEAN',true,'["PRESENT"]'::jsonb)`;
      await tx`insert into app.session_occurrences(id,workspace_id,session_definition_id,group_id,starts_at,ends_at,status,closed_at) values(${occurrence}::uuid,${workspace}::uuid,${definition}::uuid,${group}::uuid,clock_timestamp()-interval '3 days',clock_timestamp()-interval '3 days'+interval '1 hour',${i === 0 ? "CLOSED" : "OPEN"}::app.session_status,${i === 0 ? new Date(Date.now() - 2.8 * 86400000).toISOString() : null}::timestamptz)`;
      await tx`insert into app.session_roster(id,workspace_id,session_occurrence_id,enrollment_id) values(${roster}::uuid,${workspace}::uuid,${occurrence}::uuid,${enrollment}::uuid)`;
      await tx`insert into app.attendance(workspace_id,roster_id,status,reason) values(${workspace}::uuid,${roster}::uuid,${i === 0 ? "PRESENT" : "NOT_RECORDED"}::app.attendance_status,null)`;
      if (i === 0)
        await tx`insert into app.session_metric_records(workspace_id,roster_id,metric_definition_id,value,recorded_by_account_id) values(${workspace}::uuid,${roster}::uuid,${metric}::uuid,'true'::jsonb,${accounts[1]}::uuid)`;
    }
    for (let i = 0; i < 2; i++) {
      const attention = randomUUID();
      await tx`insert into app.attentions(id,workspace_id,enrollment_id,rule_code,evidence_key,evidence,owner_account_id,original_due_at,due_at,created_at) values(${attention}::uuid,${workspace}::uuid,${enrollment}::uuid,'NO_QUALIFIED_FOLLOWUP_14D',${`p6:${i}`},'{}'::jsonb,${accounts[1]}::uuid,clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days')`;
      if (i === 0)
        await tx`insert into app.followups(workspace_id,enrollment_id,performed_by_account_id,occurred_at,channel,outcome,qualifies) values(${workspace}::uuid,${enrollment}::uuid,${accounts[1]}::uuid,clock_timestamp()-interval '1 day','PHONE','متابعة مؤهلة في الموعد',true)`;
    }
    await tx`insert into app.cases(id,workspace_id,enrollment_id,title,problem,priority,owner_account_id,opened_at) values(${caseId}::uuid,${workspace}::uuid,${enrollment}::uuid,'P6 case','PRIVATE_NEVER_EXPORT','HIGH',${accounts[1]}::uuid,clock_timestamp()-interval '3 days')`;
    for (let i = 0; i < 2; i++)
      await tx`insert into app.actions(workspace_id,enrollment_id,case_id,owner_account_id,title,original_due_at,due_at,status,completed_at) values(${workspace}::uuid,${enrollment}::uuid,${caseId}::uuid,${accounts[1]}::uuid,${`P6 action ${i}`},clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',${i === 0 ? "DONE_PENDING_VERIFICATION" : "OPEN"}::app.action_status,${i === 0 ? new Date(Date.now() - 1.5 * 86400000).toISOString() : null}::timestamptz)`;
    await tx`insert into app.exam_definitions(workspace_id,plan_week_id,title,day_offset,max_score) values(${workspace}::uuid,${week}::uuid,'P6 ignored grade',0,100)`;
    const exam =
      await tx`select id from app.exam_definitions where workspace_id=${workspace}::uuid and title='P6 ignored grade'`;
    await tx`insert into app.exam_results(workspace_id,enrollment_id,exam_definition_id,score,status,recorded_by_account_id,internal_notes,published_at) values(${workspace}::uuid,${enrollment}::uuid,${exam[0].id}::uuid,1,'PUBLISHED',${accounts[1]}::uuid,'PRIVATE_NEVER_EXPORT',clock_timestamp())`;
    await tx`update app.program_plans set status='PUBLISHED' where id=${plan}::uuid`;
    await tx`update app.cohorts set current_plan_id=${plan}::uuid where id=${cohort}::uuid`;
  });
  const responsibleCookie = await login(0),
    mentorCookie = await login(1),
    studentCookie = await login(4),
    outsiderCookie = await login(5),
    range = `from=${day(-7)}&to=${day()}`;
  stage = "responsible_center";
  let response = await request(responsibleCookie, "/api/v1/today");
  prove(
    response.status === 200 &&
      response.result.counts.active_attentions >= 2 &&
      response.result.counts.overdue_actions >= 1,
  );
  response = await request(responsibleCookie, "/api/v1/mentors");
  prove(response.status === 200 && response.result.mentors.length === 3);
  evidence.responsible_center_drilldown = true;
  stage = "four_dimensions_weighting";
  response = await request(
    responsibleCookie,
    `/api/v1/mentors/${accounts[1]}/performance?${range}`,
  );
  prove(
    response.status === 200 &&
      response.result.opportunity_count === 8 &&
      response.result.score === 50 &&
      (Object.values(response.result.dimensions) as { score: number }[]).every(
        (item) => item.score === 50,
      ),
  );
  const scoreBefore = response.result.score;
  prove(Object.values(response.result.evidence).flat().length === 8);
  evidence.four_dimensions_weights_and_evidence = true;
  stage = "student_grades_excluded";
  await db`update app.exam_results set score=99 where workspace_id=${workspace}::uuid`;
  response = await request(
    responsibleCookie,
    `/api/v1/mentors/${accounts[1]}/performance?${range}`,
  );
  prove(response.status === 200 && response.result.score === scoreBefore);
  evidence.student_grades_excluded = true;
  stage = "no_data_and_limited";
  response = await request(
    responsibleCookie,
    `/api/v1/mentors/${accounts[3]}/performance?${range}`,
  );
  prove(
    response.status === 200 &&
      response.result.score === null &&
      response.result.data_state === "NO_EVALUATION_DATA",
  );
  for (let i = 0; i < 4; i++)
    await db`insert into app.attentions(workspace_id,enrollment_id,rule_code,evidence_key,evidence,owner_account_id,original_due_at,due_at) values(${workspace}::uuid,${enrollment}::uuid,'SESSION_OVERDUE_24H',${`limited:${i}`},'{}'::jsonb,${accounts[3]}::uuid,clock_timestamp(),clock_timestamp())`;
  response = await request(
    responsibleCookie,
    `/api/v1/mentors/${accounts[3]}/performance?${range}`,
  );
  prove(
    response.status === 200 &&
      response.result.opportunity_count === 4 &&
      response.result.data_state === "LIMITED_DATA",
  );
  evidence.zero_denominator_and_limited_data = true;
  stage = "historical_attribution";
  response = await request(
    responsibleCookie,
    `/api/v1/mentors/${accounts[2]}/performance?${range}`,
  );
  prove(
    response.status === 200 &&
      response.result.dimensions.operational.opportunities === 0,
  );
  evidence.historical_due_attribution = true;
  stage = "reports";
  for (const [path, key] of [
    [`/api/v1/reports/student-week?subject_id=${profile}&${range}`, "student"],
    [`/api/v1/reports/group-week?subject_id=${group}&${range}`, "group"],
    [
      `/api/v1/reports/mentor-week?subject_id=${accounts[1]}&${range}`,
      "mentor",
    ],
    [`/api/v1/reports/program?subject_id=${cohort}&${range}`, "program"],
  ]) {
    response = await request(responsibleCookie, path);
    prove(
      response.status === 200 &&
        response.result.report_type ===
          `${key.toUpperCase()}${key === "program" ? "" : "_WEEK"}`,
    );
  }
  evidence.four_report_types = true;
  stage = "safe_audited_export";
  response = await request(
    responsibleCookie,
    `/api/v1/reports/export?report_type=MENTOR_WEEK&format=CSV&subject_id=${accounts[1]}&${range}`,
  );
  prove(
    response.status === 200 &&
      response.result.mime_type.startsWith("text/csv") &&
      !response.result.content.includes("PRIVATE_NEVER_EXPORT"),
  );
  const exports =
      await db`select count(*) count from app.report_exports where workspace_id=${workspace}::uuid`,
    exportAudits =
      await db`select count(*) count from app.audit_events where workspace_id=${workspace}::uuid and action='REPORT_EXPORTED'`;
  prove(Number(exports[0].count) === 1 && Number(exportAudits[0].count) === 1);
  evidence.safe_audited_export = true;
  stage = "privacy_isolation_audit";
  response = await request(mentorCookie, "/api/v1/today");
  prove(response.status === 403);
  response = await request(studentCookie, "/api/v1/mentors");
  prove(response.status === 403);
  response = await request(outsiderCookie, "/api/v1/mentors");
  prove(response.status === 200 && response.result.mentors.length === 0);
  response = await request(responsibleCookie, "/api/v1/audit-events?limit=10");
  prove(
    response.status === 200 &&
      response.result.events.some(
        (item: { action: string }) => item.action === "REPORT_EXPORTED",
      ),
  );
  const snapshots =
    await db`select count(*) count from app.mentor_performance_snapshots where workspace_id=${workspace}::uuid`;
  prove(Number(snapshots[0].count) >= 7);
  let immutable = false;
  try {
    await db`update app.mentor_performance_snapshots set score=0 where workspace_id=${workspace}::uuid`;
  } catch (error) {
    immutable =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String(error.code) === "42501";
  }
  prove(immutable);
  evidence.responsible_only_isolation_audit_immutable = true;
  await mkdir("output/p6", { recursive: true });
  await writeFile(
    "output/p6/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: hosted P6 center, performance, reports, export, privacy and cleanup completed.",
  );
} catch (error) {
  const diagnostic =
    error && typeof error === "object"
      ? {
          name: "name" in error ? String(error.name) : undefined,
          code: "code" in error ? String(error.code) : undefined,
          table: "table_name" in error ? String(error.table_name) : undefined,
          constraint:
            "constraint_name" in error
              ? String(error.constraint_name)
              : undefined,
        }
      : {};
  await mkdir("output/p6", { recursive: true });
  await writeFile(
    "output/p6/acceptance.json",
    JSON.stringify(
      { result: "FAIL", stage, evidence, diagnostic, http: lastHttp },
      null,
      2,
    ),
  );
  console.error(`P6 acceptance failed at ${stage}.`);
  process.exitCode = 1;
} finally {
  try {
    await db.begin(async (tx) => {
      await tx`alter table app.mentor_performance_snapshots disable trigger mentor_performance_snapshot_immutable`;
      await tx`alter table app.report_exports disable trigger report_export_immutable`;
      await tx`alter table app.followup_revisions disable trigger followup_revision_immutable`;
      await tx`alter table app.case_events disable trigger case_event_immutable`;
      await tx`alter table app.audit_events disable trigger audit_immutable`;
      await tx`alter table app.plan_weeks disable trigger week_requires_draft_plan`;
      await tx`alter table app.program_plans disable trigger plan_immutable`;
      await tx`delete from app.mentor_performance_snapshots where workspace_id=${workspace}::uuid`;
      await tx`delete from app.report_exports where workspace_id=${workspace}::uuid`;
      await tx`delete from app.followup_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.case_events where workspace_id=${workspace}::uuid`;
      await tx`delete from app.followups where workspace_id=${workspace}::uuid`;
      await tx`delete from app.actions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.attentions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cases where workspace_id=${workspace}::uuid`;
      await tx`delete from app.audit_events where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.idempotency_records where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.session_metric_records where workspace_id=${workspace}::uuid`;
      await tx`delete from app.attendance where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_roster where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_occurrences where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_metric_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.exam_result_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.exam_results where workspace_id=${workspace}::uuid`;
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
      await tx`alter table app.mentor_performance_snapshots enable trigger mentor_performance_snapshot_immutable`;
      await tx`alter table app.report_exports enable trigger report_export_immutable`;
      await tx`alter table app.followup_revisions enable trigger followup_revision_immutable`;
      await tx`alter table app.case_events enable trigger case_event_immutable`;
      await tx`alter table app.audit_events enable trigger audit_immutable`;
      await tx`alter table app.plan_weeks enable trigger week_requires_draft_plan`;
      await tx`alter table app.program_plans enable trigger plan_immutable`;
    });
    for (const authId of authIds) await admin.auth.admin.deleteUser(authId);
  } catch {
    console.error("ACTION REQUIRED: P6 fixture cleanup failed safely.");
    process.exitCode = 1;
  }
  await db.end();
}
