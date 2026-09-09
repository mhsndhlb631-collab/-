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
  console.error("BLOCKED: P4 acceptance environment is incomplete.");
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
  roles = ["RESPONSIBLE", "MENTOR", "STUDENT", "MENTOR"] as const,
  names = accounts.map(
    (x, i) => `p4_${x.replaceAll("-", "").slice(0, 12)}_${i}`,
  ),
  authIds: string[] = [],
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
let templateId = "",
  planId = "",
  cohortId = "",
  groupId = "",
  enrollmentId = "",
  weekId = "",
  contentId = "",
  assignmentId = "",
  examId = "",
  submissionId = "",
  resultId = "",
  summaryId = "";
try {
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P4 acceptance','Africa/Cairo',6),(${outsiderWorkspace}::uuid,'P4 isolated','Africa/Cairo',6)`;
    for (let i = 0; i < people.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${people[i]}::uuid,${i === 3 ? outsiderWorkspace : workspace}::uuid,${`P4 Person ${i}`})`;
    await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${profile}::uuid,${workspace}::uuid,${people[2]}::uuid)`;
    for (let i = 0; i < accounts.length; i++)
      await tx`insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role) values(${accounts[i]}::uuid,${i === 3 ? outsiderWorkspace : workspace}::uuid,${people[i]}::uuid,${names[i]},${roles[i]})`;
  });
  for (let i = 0; i < accounts.length; i++) {
    stage = `identity_${i}`;
    await identity(i);
  }
  const responsible = await login(0),
    mentor = await login(1),
    student = await login(2),
    outsider = await login(3);
  evidence.safe_identity_and_login = true;
  stage = "plan";
  let response = await request(
    responsible,
    "/api/v1/program-templates",
    "POST",
    { name: "برنامج تعلم القبول", level: "تمهيدي" },
  );
  prove(response.response.status === 200);
  templateId = response.result.id;
  response = await request(
    responsible,
    `/api/v1/program-templates/${templateId}/plans`,
    "POST",
    {
      name: "خطة تعلم القبول",
      weeks: [
        {
          week_number: 1,
          week_type: "STANDARD",
          title: "أسبوع التعلم",
          objectives: ["فهم وتطبيق"],
        },
      ],
      sessions: [],
      tracking: [],
      content: [
        {
          week_number: 1,
          title: "درس الصدق",
          body: "اقرأ الدرس ثم طبّق أثرًا واحدًا.",
        },
      ],
      assignments: [
        {
          week_number: 1,
          title: "تطبيق الصدق",
          instructions: "اكتب موقفًا عمليًا.",
          due_day_offset: 5,
          max_score: 10,
          weight: 1,
        },
      ],
      exams: [
        {
          week_number: 1,
          title: "اختبار الصدق",
          day_offset: 6,
          max_score: 20,
          weight: 1,
        },
      ],
    },
  );
  prove(response.response.status === 200);
  planId = response.result.id;
  response = await request(responsible, "/api/v1/cohorts", "POST", {
    name: "دفعة تعلم القبول",
    source_plan_id: planId,
    starts_on: "2026-09-06",
    ends_on: "2026-10-03",
    groups: ["مجموعة التعلم"],
  });
  prove(response.response.status === 200);
  cohortId = response.result.id;
  groupId = response.result.groups[0].id;
  const copied =
    await db`select pw.id week_id,ci.id content_id,ad.id assignment_id,ed.id exam_id from app.plan_weeks pw join app.content_items ci on ci.plan_week_id=pw.id join app.assignment_definitions ad on ad.plan_week_id=pw.id join app.exam_definitions ed on ed.plan_week_id=pw.id where pw.plan_id=${response.result.plan_id}::uuid`;
  prove(copied[0]);
  weekId = copied[0].week_id;
  contentId = copied[0].content_id;
  assignmentId = copied[0].assignment_id;
  examId = copied[0].exam_id;
  evidence.independent_learning_copy = true;
  response = await request(responsible, "/api/v1/enrollments", "POST", {
    student_profile_id: profile,
    cohort_id: cohortId,
    group_id: groupId,
    effective_from: "2026-09-06T00:00:00Z",
  });
  prove(response.response.status === 200);
  enrollmentId = response.result.id;
  response = await request(responsible, "/api/v1/mentor-assignments", "POST", {
    group_id: groupId,
    mentor_person_id: people[1],
    effective_at: "2026-09-06T00:00:00Z",
  });
  prove(response.response.status === 200);
  stage = "content";
  let studentView = await request(student, "/api/v1/learning");
  prove(
    studentView.response.status === 200 &&
      studentView.result.content.length === 0,
  );
  evidence.unpublished_content_hidden = true;
  response = await request(
    responsible,
    `/api/v1/content/${contentId}/publish`,
    "POST",
    {},
  );
  prove(response.response.status === 200);
  studentView = await request(student, "/api/v1/learning");
  prove(studentView.result.content.length === 1);
  evidence.published_content_visible = true;
  stage = "assignment";
  response = await request(
    student,
    `/api/v1/assignments/${assignmentId}/submission`,
    "PUT",
    {
      enrollment_id: enrollmentId,
      answer: "طبقت الصدق في وعد قطعته.",
      row_version: null,
      reason: null,
    },
  );
  prove(response.response.status === 200);
  submissionId = response.result.id;
  response = await request(
    mentor,
    `/api/v1/submissions/${submissionId}/review`,
    "POST",
    {
      score: 8,
      internal_notes: "ملاحظة داخلية لا تظهر",
      student_feedback: "تطبيق واضح.",
      publish_feedback: true,
      row_version: 1,
      reason: null,
    },
  );
  prove(response.response.status === 200 && response.result.row_version === 2);
  studentView = await request(student, "/api/v1/learning");
  prove(!JSON.stringify(studentView.result).includes("ملاحظة داخلية"));
  evidence.assignment_submission_review_and_private_notes = true;
  stage = "exam";
  response = await request(mentor, `/api/v1/exams/${examId}/results`, "PUT", {
    enrollment_id: enrollmentId,
    score: 16,
    internal_notes: "تحليل داخلي",
    student_feedback: "نتيجة جيدة",
    row_version: null,
    reason: null,
  });
  prove(response.response.status === 200);
  resultId = response.result.id;
  studentView = await request(student, "/api/v1/learning");
  prove(!JSON.stringify(studentView.result).includes(resultId));
  evidence.draft_exam_hidden = true;
  response = await request(
    mentor,
    `/api/v1/exams/results/${resultId}/publish`,
    "POST",
    { row_version: 1 },
  );
  prove(response.response.status === 200 && response.result.row_version === 2);
  studentView = await request(student, "/api/v1/learning");
  prove(
    JSON.stringify(studentView.result).includes(resultId) &&
      !JSON.stringify(studentView.result).includes("تحليل داخلي"),
  );
  evidence.published_exam_visible_without_internal_notes = true;
  stage = "self_review";
  response = await request(
    student,
    `/api/v1/me/weeks/${weekId}/self-review`,
    "PUT",
    {
      enrollment_id: enrollmentId,
      rating: 4,
      reflection: "تعلمت أن أثبت الصدق في المواقف اليومية.",
      row_version: null,
    },
  );
  prove(response.response.status === 200);
  evidence.student_self_review = true;
  stage = "week";
  response = await request(
    mentor,
    `/api/v1/students/${profile}/weeks/${weekId}`,
  );
  prove(
    response.response.status === 200 &&
      response.result.coverage === 1 &&
      response.result.evidence.components.sessions.expected === 0 &&
      response.result.evidence.components.tracking.expected === 0,
  );
  evidence.deterministic_full_coverage = true;
  response = await request(
    mentor,
    `/api/v1/students/${profile}/weeks/${weekId}/approve`,
    "POST",
    { row_version: null, reason: null },
  );
  prove(response.response.status === 200 && response.result.revision === 1);
  summaryId = response.result.id;
  const firstScore = Number(response.result.score);
  prove(firstScore === 80);
  evidence.first_immutable_approval = true;
  stage = "correction";
  response = await request(
    mentor,
    `/api/v1/exams/${examId}/corrections`,
    "POST",
    {
      enrollment_id: enrollmentId,
      score: 20,
      internal_notes: "تحليل مصحح",
      student_feedback: "تم تصحيح النتيجة",
      row_version: 2,
      reason: "تصحيح رصد الدرجة",
    },
  );
  prove(response.response.status === 200 && response.result.row_version === 3);
  response = await request(
    mentor,
    `/api/v1/exams/results/${resultId}/publish`,
    "POST",
    { row_version: 3 },
  );
  prove(response.response.status === 200 && response.result.row_version === 4);
  const stale = await request(
    mentor,
    `/api/v1/students/${profile}/weeks/${weekId}/corrections`,
    "POST",
    { row_version: 2, reason: "نسخة قديمة" },
  );
  prove(stale.response.status === 409);
  evidence.stale_week_revision_rejected = true;
  response = await request(
    mentor,
    `/api/v1/students/${profile}/weeks/${weekId}/corrections`,
    "POST",
    { row_version: 1, reason: "اعتماد الدرجة المصححة" },
  );
  prove(
    response.response.status === 200 &&
      response.result.revision === 2 &&
      Number(response.result.score) === 90,
  );
  const revisions =
    await db`select approval_revision,(snapshot->>'score')::numeric score from app.student_week_approval_revisions where summary_id=${summaryId}::uuid order by approval_revision`;
  prove(
    revisions.length === 2 &&
      Number(revisions[0].score) === 80 &&
      Number(revisions[1].score) === 90,
  );
  evidence.correction_creates_second_approval_snapshot = true;
  stage = "isolation";
  response = await request(
    outsider,
    `/api/v1/students/${profile}/weeks/${weekId}`,
  );
  prove(response.response.status === 404);
  evidence.cross_workspace_denied = true;
  const audits =
    await db`select count(*) count from app.audit_events where workspace_id=${workspace}::uuid and action in ('CONTENT_PUBLISHED','ASSIGNMENT_SUBMITTED','ASSIGNMENT_REVIEWED','EXAM_RESULT_RECORDED','EXAM_RESULT_PUBLISHED','STUDENT_SELF_REVIEWED','STUDENT_WEEK_APPROVED','STUDENT_WEEK_CORRECTED')`;
  prove(Number(audits[0].count) >= 8);
  evidence.atomic_audit = true;
  await mkdir("output/p4", { recursive: true });
  await writeFile(
    "output/p4/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: hosted P4 learning, publication, weekly approval, correction, privacy and cleanup completed.",
  );
} catch {
  await mkdir("output/p4", { recursive: true });
  await writeFile(
    "output/p4/acceptance.json",
    JSON.stringify(
      { result: "FAIL", stage, failure_code: "assertion", evidence },
      null,
      2,
    ),
  );
  console.error(`P4 acceptance failed at ${stage}; sanitized evidence saved.`);
  process.exitCode = 1;
} finally {
  try {
    await db.begin(async (tx) => {
      for (const trigger of [
        "week_approval_immutable on app.student_week_approval_revisions",
        "exam_revision_immutable on app.exam_result_revisions",
        "assignment_revision_immutable on app.assignment_submission_revisions",
      ])
        await tx.unsafe(
          `alter table ${trigger.split(" on ")[1]} disable trigger ${trigger.split(" on ")[0]}`,
        );
      await tx`delete from app.audit_events where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.idempotency_records where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.student_week_approval_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_week_summaries where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_self_reviews where workspace_id=${workspace}::uuid`;
      await tx`delete from app.exam_result_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.exam_results where workspace_id=${workspace}::uuid`;
      await tx`delete from app.assignment_submission_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.assignment_submissions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_metric_records where workspace_id=${workspace}::uuid`;
      await tx`delete from app.attendance where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_roster where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_occurrences where workspace_id=${workspace}::uuid`;
      await tx`delete from app.group_memberships where workspace_id=${workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${workspace}::uuid`;
      await tx`delete from app.exam_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.assignment_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.content_items where workspace_id=${workspace}::uuid`;
      await tx`delete from app.tracking_schedules where workspace_id=${workspace}::uuid`;
      await tx`delete from app.tracking_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_metric_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_profiles where workspace_id=${workspace}::uuid`;
      await tx`delete from app.login_accounts where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.persons where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.workspaces where id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      for (const trigger of [
        "week_approval_immutable on app.student_week_approval_revisions",
        "exam_revision_immutable on app.exam_result_revisions",
        "assignment_revision_immutable on app.assignment_submission_revisions",
      ])
        await tx.unsafe(
          `alter table ${trigger.split(" on ")[1]} enable trigger ${trigger.split(" on ")[0]}`,
        );
    });
  } catch (cleanupError) {
    const code =
      typeof cleanupError === "object" &&
      cleanupError &&
      "code" in cleanupError
        ? String(cleanupError.code)
        : "unknown";
    console.error(
      `ACTION REQUIRED: P4 fixture cleanup failed safely (${code}).`,
    );
    process.exitCode = 1;
  }
  for (const authId of authIds)
    await admin.auth.admin.deleteUser(authId).catch(() => undefined);
  await db.end();
}
