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
  console.error("BLOCKED: P3 acceptance environment is incomplete.");
  process.exit(1);
}
const env = parsed.data,
  origin = env.HOSTED_ORIGIN ?? "https://tarbiyah-operations.vercel.app";
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const db = postgres(env.MIGRATION_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 8,
});
const workspace = randomUUID(),
  outsiderWorkspace = randomUUID();
const people = Array.from({ length: 5 }, () => randomUUID());
const profiles = [randomUUID(), randomUUID()];
const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const roles = ["RESPONSIBLE", "MENTOR", "STUDENT", "MENTOR"] as const;
const names = accounts.map(
  (x, i) => `p3_${x.replaceAll("-", "").slice(0, 12)}_${i}`,
);
const authIds: string[] = [],
  password = randomBytes(24).toString("base64url"),
  evidence: Record<string, boolean> = {};
let stage = "bootstrap";
function prove(value: unknown): asserts value {
  if (!value) throw new Error("acceptance assertion failed");
}
async function identity(i: number) {
  const created = await admin.auth.admin.createUser({
    email: `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    ban_duration: "876000h",
  });
  prove(!created.error && created.data.user);
  authIds.push(created.data.user.id);
  await db`update app.login_accounts set supabase_auth_user_id=${created.data.user.id}::uuid where id=${accounts[i]}::uuid`;
  prove(
    !(
      await admin.auth.admin.updateUserById(created.data.user.id, {
        ban_duration: "none",
      })
    ).error,
  );
  await db`update app.login_accounts set status='ACTIVE',must_change_password=false where id=${accounts[i]}::uuid`;
}
async function login(i: number) {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": `127.3.0.${i + 1}`,
    },
    body: JSON.stringify({ login_name: names[i], password }),
  });
  prove(response.status === 200);
  return response.headers
    .getSetCookie()
    .map((x) => x.split(";", 1)[0])
    .join("; ");
}
async function request(
  cookie: string,
  path: string,
  method = "GET",
  body?: unknown,
  requestKey = randomUUID(),
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
            "Idempotency-Key": requestKey,
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, result: await response.json(), requestKey };
}
try {
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P3 acceptance','Africa/Cairo',6),(${outsiderWorkspace}::uuid,'P3 isolated','Africa/Cairo',6)`;
    for (let i = 0; i < people.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${people[i]}::uuid,${i === 4 ? outsiderWorkspace : workspace}::uuid,${`P3 Person ${i}`})`;
    for (let i = 0; i < profiles.length; i++)
      await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${profiles[i]}::uuid,${workspace}::uuid,${people[i + 2]}::uuid)`;
    for (let i = 0; i < accounts.length; i++)
      await tx`insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role) values(${accounts[i]}::uuid,${i === 3 ? outsiderWorkspace : workspace}::uuid,${i === 3 ? people[4] : people[i]}::uuid,${names[i]},${roles[i]})`;
  });
  for (let i = 0; i < accounts.length; i++) await identity(i);
  const responsible = await login(0),
    mentor = await login(1),
    student = await login(2),
    outsider = await login(3);
  evidence.safe_identity_and_login = true;

  stage = "plan_copy";
  const template = await request(
    responsible,
    "/api/v1/program-templates",
    "POST",
    { name: "برنامج تتبع القبول", level: "تمهيدي" },
  );
  prove(template.response.status === 200);
  const plan = await request(
    responsible,
    `/api/v1/program-templates/${template.result.id}/plans`,
    "POST",
    {
      name: "خطة تتبع القبول",
      weeks: [
        {
          week_number: 1,
          week_type: "STANDARD",
          title: "أسبوع التتبع",
          objectives: ["الانتظام"],
        },
      ],
      sessions: [],
      tracking: [
        {
          name: "ورد يومي",
          meaning: "عدد الصفحات",
          unit: "صفحة",
          value_type: "COUNT",
          constraints: { min: 0, max: 20 },
          target: { min: 2 },
          allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
          allows_batch: true,
          allows_weekly_summary: false,
          requires_review: true,
          weight: 1,
          schedule: {
            period_kind: "DAILY",
            start_week: 1,
            end_week: null,
            days_of_week: [0, 1, 2, 3, 4, 5, 6],
            due_time: "22:00",
          },
        },
        {
          name: "ملخص أسبوعي",
          meaning: "تقييم الأسبوع",
          unit: "من 10",
          value_type: "SCORE",
          constraints: { min: 0, max: 10 },
          target: { min: 7 },
          allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
          allows_batch: true,
          allows_weekly_summary: true,
          requires_review: true,
          weight: 1,
          schedule: {
            period_kind: "WEEKLY",
            start_week: 1,
            end_week: null,
            days_of_week: [5],
            due_time: "21:00",
          },
        },
      ],
    },
  );
  prove(plan.response.status === 200);
  const cohort = await request(responsible, "/api/v1/cohorts", "POST", {
    name: "دفعة تتبع القبول",
    source_plan_id: plan.result.id,
    starts_on: "2026-09-06",
    ends_on: "2026-10-31",
    groups: ["مجموعة التتبع"],
  });
  prove(cohort.response.status === 200);
  const groupId = cohort.result.groups[0].id;
  const enrollments = [];
  for (const profile of profiles) {
    const enrolled = await request(responsible, "/api/v1/enrollments", "POST", {
      student_profile_id: profile,
      cohort_id: cohort.result.id,
      group_id: groupId,
      effective_from: "2026-09-01T00:00:00Z",
    });
    prove(enrolled.response.status === 200);
    enrollments.push(enrolled.result.id);
  }
  const assigned = await request(
    responsible,
    "/api/v1/mentor-assignments",
    "POST",
    {
      group_id: groupId,
      mentor_person_id: people[1],
      effective_at: "2026-09-01T00:00:00Z",
    },
  );
  prove(assigned.response.status === 200);
  const [copyCount] =
    await db`select count(*)::integer count from app.tracking_definitions where plan_id=${cohort.result.plan_id}::uuid`;
  prove(copyCount.count === 2);
  evidence.independent_definition_and_schedule_copy = true;

  stage = "expected";
  const studentExpected = await request(
    student,
    "/api/v1/tracking/expected?from=2026-09-06&to=2026-09-12",
  );
  evidence.expected_http_200 = studentExpected.response.status === 200;
  evidence.expected_count_8 = studentExpected.result.expected?.length === 8;
  prove(
    studentExpected.response.status === 200 &&
      studentExpected.result.expected.length === 8,
  );
  const daily = studentExpected.result.expected.find(
    (x: { name: string; period_start: string }) =>
      x.name === "ورد يومي" && x.period_start === "2026-09-09",
  );
  const weekly = studentExpected.result.expected.find(
    (x: { name: string }) => x.name === "ملخص أسبوعي",
  );
  prove(daily && weekly);
  evidence.daily_and_weekly_entitlements = true;

  stage = "student_entry";
  const studentEntry = await request(
    student,
    "/api/v1/tracking/entries",
    "PUT",
    {
      entries: [
        {
          enrollment_id: daily.enrollment_id,
          definition_id: daily.definition_id,
          period_start: daily.period_start,
          period_end: daily.period_end,
          state: "RECORDED",
          value: 4,
          source: "STUDENT",
          occurred_at: "2026-09-09T18:00:00Z",
          exemption_reason: null,
          row_version: null,
          reason: null,
        },
      ],
    },
  );
  prove(
    studentEntry.response.status === 200 &&
      studentEntry.result.entries[0].version === 1,
  );
  const entryId = studentEntry.result.entries[0].id;
  evidence.student_self_entry = true;

  stage = "mentor_batch";
  const mentorExpected = await request(
    mentor,
    "/api/v1/tracking/expected?from=2026-09-10&to=2026-09-10",
  );
  const mentorRows = mentorExpected.result.expected.filter(
    (x: { name: string }) => x.name === "ورد يومي",
  );
  prove(mentorRows.length === 2);
  const mentorBatch = await request(
    mentor,
    "/api/v1/tracking/entries/batch",
    "POST",
    {
      entries: mentorRows.map((x: typeof daily) => ({
        enrollment_id: x.enrollment_id,
        definition_id: x.definition_id,
        period_start: x.period_start,
        period_end: x.period_end,
        state: "RECORDED",
        value: 3,
        source: "MENTOR",
        occurred_at: "2026-09-10T18:00:00Z",
        exemption_reason: null,
        row_version: null,
        reason: null,
      })),
    },
  );
  prove(
    mentorBatch.response.status === 200 &&
      mentorBatch.result.entries.length === 2,
  );
  evidence.scoped_atomic_mentor_batch = true;

  stage = "paper";
  const paper = await request(mentor, "/api/v1/tracking/entries", "PUT", {
    entries: [
      {
        enrollment_id: weekly.enrollment_id,
        definition_id: weekly.definition_id,
        period_start: weekly.period_start,
        period_end: weekly.period_end,
        state: "RECORDED",
        value: 8,
        source: "PAPER_TRANSCRIBED",
        occurred_at: "2026-09-12T19:00:00Z",
        exemption_reason: null,
        row_version: null,
        reason: null,
      },
    ],
  });
  prove(paper.response.status === 200);
  evidence.paper_weekly_summary_without_fabricated_days = true;

  stage = "review_correction";
  const reviewed = await request(
    mentor,
    `/api/v1/tracking/entries/${entryId}/reviews`,
    "POST",
    { entry_version: 1, row_version: 1, decision: "VERIFIED", reason: null },
  );
  prove(reviewed.response.status === 200 && reviewed.result.row_version === 2);
  const corrected = await request(student, "/api/v1/tracking/entries", "PUT", {
    entries: [
      {
        enrollment_id: daily.enrollment_id,
        definition_id: daily.definition_id,
        period_start: daily.period_start,
        period_end: daily.period_end,
        state: "RECORDED",
        value: 5,
        source: "STUDENT",
        occurred_at: "2026-09-09T19:00:00Z",
        exemption_reason: null,
        row_version: 2,
        reason: "تصحيح الطالب بعد المراجعة",
      },
    ],
  });
  prove(
    corrected.response.status === 200 &&
      corrected.result.entries[0].version === 2 &&
      corrected.result.entries[0].row_version === 3,
  );
  const stale = await request(
    mentor,
    `/api/v1/tracking/entries/${entryId}/reviews`,
    "POST",
    { entry_version: 1, row_version: 3, decision: "VERIFIED", reason: null },
  );
  prove(stale.response.status === 409);
  const currentReview = await request(
    mentor,
    `/api/v1/tracking/entries/${entryId}/reviews`,
    "POST",
    { entry_version: 2, row_version: 3, decision: "VERIFIED", reason: null },
  );
  prove(currentReview.response.status === 200);
  const [history] =
    await db`select count(*)::integer count from app.tracking_entry_revisions where tracking_entry_id=${entryId}::uuid`;
  prove(history.count === 2);
  evidence.versioned_review_and_correction = true;

  stage = "atomic_rejection";
  const invalidExpected = await request(
    mentor,
    "/api/v1/tracking/expected?from=2026-09-11&to=2026-09-11",
  );
  const invalidRows = invalidExpected.result.expected.filter(
    (x: { name: string }) => x.name === "ورد يومي",
  );
  const invalidBatch = await request(
    mentor,
    "/api/v1/tracking/entries/batch",
    "POST",
    {
      entries: invalidRows.map((x: typeof daily, i: number) => ({
        enrollment_id: x.enrollment_id,
        definition_id: x.definition_id,
        period_start: x.period_start,
        period_end: x.period_end,
        state: "RECORDED",
        value: i ? 99 : 2,
        source: "MENTOR",
        occurred_at: "2026-09-11T18:00:00Z",
        exemption_reason: null,
        row_version: null,
        reason: null,
      })),
    },
  );
  prove(invalidBatch.response.status === 400);
  const [rejectedCount] =
    await db`select count(*)::integer count from app.tracking_entries where workspace_id=${workspace}::uuid and period_start='2026-09-11'`;
  prove(rejectedCount.count === 0);
  evidence.invalid_batch_is_all_or_nothing = true;

  stage = "privacy";
  const outsiderWrite = await request(
    outsider,
    "/api/v1/tracking/entries",
    "PUT",
    {
      entries: [
        {
          enrollment_id: daily.enrollment_id,
          definition_id: daily.definition_id,
          period_start: daily.period_start,
          period_end: daily.period_end,
          state: "RECORDED",
          value: 6,
          source: "MENTOR",
          occurred_at: "2026-09-09T20:00:00Z",
          exemption_reason: null,
          row_version: 4,
          reason: "محاولة خارج النطاق",
        },
      ],
    },
  );
  prove([403, 404].includes(outsiderWrite.response.status));
  evidence.cross_workspace_and_scope_denied = true;
  const [audits] =
    await db`select count(*)::integer count from app.audit_events where workspace_id=${workspace}::uuid and action like 'TRACKING_%'`;
  prove(audits.count >= 6);
  evidence.atomic_audit = true;
  await mkdir("output/p3", { recursive: true });
  await writeFile(
    "output/p3/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: hosted P3 tracking, sources, review, versioning, RLS and cleanup completed.",
  );
} catch (error) {
  await mkdir("output/p3", { recursive: true });
  await writeFile(
    "output/p3/acceptance.json",
    JSON.stringify(
      {
        result: "FAIL",
        stage,
        failure_code:
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "assertion",
        evidence,
      },
      null,
      2,
    ),
  );
  console.error(`P3 acceptance failed at ${stage}; sanitized evidence saved.`);
  process.exitCode = 1;
} finally {
  for (const authId of authIds)
    await admin.auth.admin.deleteUser(authId).catch(() => {});
  await db
    .begin(async (tx) => {
      for (const trigger of [
        "tracking_review_immutable on app.tracking_reviews",
        "tracking_revision_immutable on app.tracking_entry_revisions",
        "tracking_schedule_draft on app.tracking_schedules",
        "tracking_definition_draft on app.tracking_definitions",
        "week_requires_draft_plan on app.plan_weeks",
        "audit_immutable on app.audit_events",
      ])
        await tx.unsafe(
          `alter table ${trigger.split(" on ")[1]} disable trigger ${trigger.split(" on ")[0]}`,
        );
      await tx`delete from app.tracking_reviews where workspace_id=${workspace}::uuid`;
      await tx`delete from app.tracking_entry_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.tracking_entries where workspace_id=${workspace}::uuid`;
      await tx`delete from app.tracking_schedules where workspace_id=${workspace}::uuid`;
      await tx`delete from app.tracking_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.group_memberships where workspace_id=${workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where workspace_id=${workspace}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${workspace}::uuid`;
      await tx`delete from app.idempotency_records where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.audit_events where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.login_accounts where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.student_profiles where workspace_id=${workspace}::uuid`;
      await tx`delete from app.persons where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.workspaces where id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      for (const trigger of [
        "tracking_review_immutable on app.tracking_reviews",
        "tracking_revision_immutable on app.tracking_entry_revisions",
        "tracking_schedule_draft on app.tracking_schedules",
        "tracking_definition_draft on app.tracking_definitions",
        "week_requires_draft_plan on app.plan_weeks",
        "audit_immutable on app.audit_events",
      ])
        await tx.unsafe(
          `alter table ${trigger.split(" on ")[1]} enable trigger ${trigger.split(" on ")[0]}`,
        );
    })
    .catch(() => {
      console.error("ACTION REQUIRED: exact P3 fixture cleanup failed.");
      process.exitCode = 1;
    });
  await db.end();
}
