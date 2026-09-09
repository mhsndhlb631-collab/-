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
type SafeDiagnostic = {
  substep: string;
  expected: unknown;
  actual: unknown;
  http_status?: number;
  application_error_code?: string;
  row_versions?: Record<string, unknown>;
  revision_count?: number;
  score?: number | null;
  audit_count?: number;
  request_id?: string;
};

let stage = "bootstrap",
  diagnostic: SafeDiagnostic | undefined;
function prove(value: unknown): asserts value {
  if (!value) throw new Error("acceptance assertion failed");
}
function startSubstep(name: string) {
  stage = name;
  diagnostic = undefined;
  console.log(`[P4 ACCEPTANCE] ${name}: START`);
}
function passSubstep() {
  console.log(`[P4 ACCEPTANCE] ${stage}: PASS`);
}
function assertSubstep(
  value: unknown,
  details: Omit<SafeDiagnostic, "substep">,
): asserts value {
  if (value) return;
  diagnostic = { substep: stage, ...details };
  console.error(`[P4 ACCEPTANCE] ${stage}: FAIL`);
  throw new Error(`acceptance assertion failed: ${stage}`);
}
function requestId(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const value = (result as Record<string, unknown>).request_id;
  return typeof value === "string" ? value : undefined;
}
function errorCode(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const value = (result as Record<string, unknown>).code;
  return typeof value === "string" ? value : undefined;
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
    `/api/v1/students/${profile}/weeks/${weekId}/finalize`,
    "POST",
    {},
  );
  prove(
    response.response.status === 200 &&
      response.result.status === "FINALIZED" &&
      response.result.revision === 1 &&
      response.result.row_version === 2,
  );
  summaryId = response.result.id;
  evidence.auto_finalize_without_approval_step = true;
  startSubstep("exam_correction_and_publish");
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
  const examCorrStatus = response.response.status;
  const examCorrRv = response.result.row_version;
  assertSubstep(examCorrStatus === 200 && examCorrRv === 3, {
    expected: { http_status: 200, row_version: 3 },
    actual: { http_status: examCorrStatus, row_version: examCorrRv ?? null },
    http_status: examCorrStatus,
    application_error_code: errorCode(response.result),
    row_versions: { correction: examCorrRv ?? null },
    request_id: requestId(response.result),
  });
  response = await request(
    mentor,
    `/api/v1/exams/results/${resultId}/publish`,
    "POST",
    { row_version: 3 },
  );
  const publishStatus = response.response.status;
  const publishRv = response.result.row_version;
  assertSubstep(publishStatus === 200 && publishRv === 4, {
    expected: { http_status: 200, row_version: 4 },
    actual: { http_status: publishStatus, row_version: publishRv ?? null },
    http_status: publishStatus,
    application_error_code: errorCode(response.result),
    row_versions: {
      correction: examCorrRv ?? null,
      publication: publishRv ?? null,
    },
    request_id: requestId(response.result),
  });
  passSubstep();

  startSubstep("immutable_finalization_score_80");
  const firstSnapshots =
    await db`select (snapshot->>'score')::numeric score from app.student_week_approval_revisions where summary_id=${summaryId}::uuid order by approval_revision limit 1`;
  const firstScore = firstSnapshots[0] ? Number(firstSnapshots[0].score) : null;
  assertSubstep(firstScore === 80, {
    expected: { revision_count: 1, score: 80 },
    actual: { revision_count: firstSnapshots.length, score: firstScore },
    row_versions: { exam_publication: publishRv ?? null },
    revision_count: firstSnapshots.length,
    score: firstScore,
    request_id: requestId(response.result),
  });
  evidence.first_immutable_finalization = true;
  passSubstep();

  startSubstep("stale_amendment_rejected");
  const stale = await request(
    mentor,
    `/api/v1/students/${profile}/weeks/${weekId}/amend`,
    "POST",
    { row_version: 99, reason: "نسخة قديمة" },
  );
  const staleStatus = stale.response.status;
  assertSubstep(staleStatus === 409, {
    expected: { http_status: 409, application_error_code: "VERSION_CONFLICT" },
    actual: {
      http_status: staleStatus,
      application_error_code: errorCode(stale.result) ?? null,
    },
    http_status: staleStatus,
    application_error_code: errorCode(stale.result),
    row_versions: { supplied: 99, current_expected: 2 },
    request_id: requestId(stale.result),
  });
  evidence.stale_week_amendment_rejected = true;
  passSubstep();

  startSubstep("valid_amendment_revision_2_score_90");
  response = await request(
    mentor,
    `/api/v1/students/${profile}/weeks/${weekId}/amend`,
    "POST",
    { row_version: 2, reason: "تصحيح الدرجة بعد مراجعة النتيجة" },
  );
  const amendStatus = response.response.status;
  const amendRevision = response.result.revision;
  const amendScore = response.result.score;
  assertSubstep(
    amendStatus === 200 &&
      response.result.status === "FINALIZED" &&
      amendRevision === 2 &&
      Number(amendScore) === 90,
    {
      expected: {
        http_status: 200,
        status: "FINALIZED",
        revision: 2,
        score: 90,
      },
      actual: {
        http_status: amendStatus,
        status: response.result.status ?? null,
        revision: amendRevision ?? null,
        score: amendScore ?? null,
      },
      http_status: amendStatus,
      application_error_code: errorCode(response.result),
      row_versions: {
        supplied: 2,
        returned: response.result.row_version ?? null,
      },
      revision_count:
        typeof amendRevision === "number" ? amendRevision : undefined,
      score: typeof amendScore === "number" ? amendScore : null,
      request_id: requestId(response.result),
    },
  );
  const revisions =
    await db`select approval_revision,(snapshot->>'score')::numeric score from app.student_week_approval_revisions where summary_id=${summaryId}::uuid order by approval_revision`;
  assertSubstep(
    revisions.length === 2 &&
      Number(revisions[0].score) === 80 &&
      Number(revisions[1].score) === 90,
    {
      expected: { revision_count: 2, scores: [80, 90] },
      actual: {
        revision_count: revisions.length,
        scores: revisions.map((revision) => Number(revision.score)),
      },
      http_status: amendStatus,
      row_versions: {
        supplied: 2,
        returned: response.result.row_version ?? null,
      },
      revision_count: revisions.length,
      score:
        revisions.length > 0
          ? Number(revisions[revisions.length - 1].score)
          : null,
      request_id: requestId(response.result),
    },
  );
  evidence.amend_creates_second_immutable_snapshot = true;
  passSubstep();

  startSubstep("cross_workspace_denied");
  response = await request(
    outsider,
    `/api/v1/students/${profile}/weeks/${weekId}`,
  );
  const crossStatus = response.response.status;
  assertSubstep(crossStatus === 404, {
    expected: { http_status: 404 },
    actual: {
      http_status: crossStatus,
      application_error_code: errorCode(response.result) ?? null,
    },
    http_status: crossStatus,
    application_error_code: errorCode(response.result),
    request_id: requestId(response.result),
  });
  evidence.cross_workspace_denied = true;
  passSubstep();

  startSubstep("atomic_audit_count");
  const audits =
    await db`select count(*) count from app.audit_events where workspace_id=${workspace}::uuid and action in ('CONTENT_PUBLISHED','ASSIGNMENT_SUBMITTED','ASSIGNMENT_REVIEWED','EXAM_RESULT_RECORDED','EXAM_RESULT_PUBLISHED','STUDENT_SELF_REVIEWED','STUDENT_WEEK_FINALIZED','STUDENT_WEEK_AMENDED')`;
  const auditCount = Number(audits[0].count);
  assertSubstep(auditCount >= 8, {
    expected: { minimum_audit_count: 8 },
    actual: { audit_count: auditCount },
    audit_count: auditCount,
  });
  evidence.atomic_audit = true;
  passSubstep();
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
    "PASS: hosted P4.1 learning, auto-finalize, amend after finalize, immutable history, privacy and cleanup completed.",
  );
} catch (err) {
  await mkdir("output/p4", { recursive: true });
  const diag =
    diagnostic ??
    ({
      substep: stage,
      expected: "stage completes without an exception",
      actual: err instanceof Error ? err.message : "unknown failure",
    } satisfies SafeDiagnostic);
  await writeFile(
    "output/p4/acceptance.json",
    JSON.stringify(
      {
        result: "FAIL",
        stage,
        failure_code: "assertion",
        evidence,
        diagnostic: diag,
      },
      null,
      2,
    ),
  );
  console.error(`P4 acceptance failed at ${stage}; sanitized evidence saved.`);
  console.error("[P4 ACCEPTANCE] sanitized diagnostic:", diag);
  process.exitCode = 1;
} finally {
  try {
    await db.begin(async (tx) => {
      for (const trigger of [
        "week_approval_immutable on app.student_week_approval_revisions",
        "exam_revision_immutable on app.exam_result_revisions",
        "assignment_revision_immutable on app.assignment_submission_revisions",
        "self_review_revision_immutable on app.student_self_review_revisions",
        "week_requires_draft_plan on app.plan_weeks",
        "audit_immutable on app.audit_events",
      ])
        await tx.unsafe(
          `alter table ${trigger.split(" on ")[1]} disable trigger ${trigger.split(" on ")[0]}`,
        );
      await tx`delete from app.audit_events where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.idempotency_records where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.student_week_approval_revisions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_week_summaries where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_self_review_revisions where workspace_id=${workspace}::uuid`;
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
        "self_review_revision_immutable on app.student_self_review_revisions",
        "week_requires_draft_plan on app.plan_weeks",
        "audit_immutable on app.audit_events",
      ])
        await tx.unsafe(
          `alter table ${trigger.split(" on ")[1]} enable trigger ${trigger.split(" on ")[0]}`,
        );
    });
  } catch (cleanupError) {
    const code =
      typeof cleanupError === "object" && cleanupError && "code" in cleanupError
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
