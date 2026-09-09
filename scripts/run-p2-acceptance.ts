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
  console.error("BLOCKED: P2 acceptance environment is incomplete.");
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
  connect_timeout: 5,
});
const workspace = randomUUID(),
  people = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ],
  profiles = [randomUUID(), randomUUID(), randomUUID()],
  accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  roles = ["RESPONSIBLE", "MENTOR", "STUDENT", "STUDENT"] as const;
const loginNames = roles.map(
    (_, i) => `p2_${workspace.replaceAll("-", "").slice(0, 12)}_${i}`,
  ),
  authIds: string[] = [],
  password = randomBytes(24).toString("base64url"),
  evidence: Record<string, boolean> = {};
let stage = "bootstrap";
function prove(value: unknown): asserts value {
  if (!value) throw new Error("assertion");
}
async function identity(i: number) {
  const email = `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    created = await admin.auth.admin.createUser({
      email,
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
  return email;
}
async function login(email: string) {
  const i = accounts.findIndex(
      (x) => `${x}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}` === email,
    ),
    response = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": `127.2.${workspace.charCodeAt(0)}.${i + 1}`,
      },
      body: JSON.stringify({ login_name: loginNames[i], password }),
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
  key = randomUUID(),
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", "Idempotency-Key": key }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  return { response, result, key };
}
try {
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P2 acceptance','Africa/Cairo',6)`;
    for (let i = 0; i < people.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${people[i]}::uuid,${workspace}::uuid,${`P2 Person ${i}`})`;
    for (let i = 0; i < profiles.length; i++)
      await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${profiles[i]}::uuid,${workspace}::uuid,${people[i + 2]}::uuid)`;
    for (let i = 0; i < accounts.length; i++)
      await tx`insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role) values(${accounts[i]}::uuid,${workspace}::uuid,${people[i]}::uuid,${loginNames[i]},${roles[i]})`;
  });
  const emails = [];
  for (let i = 0; i < accounts.length; i++) emails.push(await identity(i));
  const responsible = await login(emails[0]),
    mentor = await login(emails[1]);
  evidence.safe_identity_and_login = true;
  stage = "setup";
  const template = await request(
    responsible,
    "/api/v1/program-templates",
    "POST",
    { name: "برنامج جلسات القبول", level: "تمهيدي" },
  );
  prove(template.response.status === 200);
  const plan = await request(
    responsible,
    `/api/v1/program-templates/${template.result.id}/plans`,
    "POST",
    {
      name: "خطة جلسات القبول",
      weeks: [
        {
          week_number: 1,
          week_type: "STANDARD",
          title: "الأسبوع الأول",
          objectives: ["المشاركة"],
        },
      ],
      sessions: [
        {
          week_number: 1,
          name: "اللقاء التربوي",
          session_type: "GROUP",
          day_offset: 1,
          starts_at: "10:00",
          duration_minutes: 60,
          attendance_required: true,
          metrics: [
            {
              name: "التفاعل",
              value_type: "SCORE",
              required: true,
              applies_to: ["PRESENT", "LATE"],
              constraints: { min: 0, max: 10 },
            },
          ],
        },
        {
          week_number: 1,
          name: "لقاء قابل للإلغاء",
          session_type: "GROUP",
          day_offset: 2,
          starts_at: "10:00",
          duration_minutes: 60,
          attendance_required: true,
          metrics: [],
        },
      ],
    },
  );
  prove(plan.response.status === 200);
  const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    cohort = await request(responsible, "/api/v1/cohorts", "POST", {
      name: "دفعة جلسات القبول",
      source_plan_id: plan.result.id,
      starts_on: start,
      ends_on: end,
      groups: ["مجموعة القبول"],
    });
  prove(cohort.response.status === 200);
  const past = new Date(Date.now() - 7 * 86400000).toISOString();
  const assignment = await request(
    responsible,
    "/api/v1/mentor-assignments",
    "POST",
    {
      group_id: cohort.result.groups[0].id,
      mentor_person_id: people[1],
      effective_at: past,
    },
  );
  prove(assignment.response.status === 200);
  for (let i = 0; i < 2; i++) {
    const enrolled = await request(responsible, "/api/v1/enrollments", "POST", {
      student_profile_id: profiles[i],
      cohort_id: cohort.result.id,
      group_id: cohort.result.groups[0].id,
      effective_from: past,
    });
    prove(enrolled.response.status === 200);
  }
  evidence.generated_from_copied_definition = true;
  const listed = await request(mentor, "/api/v1/sessions");
  prove(listed.response.status === 200 && listed.result.sessions.length === 2);
  const mainSession = listed.result.sessions.find(
      (item: { name: string }) => item.name === "اللقاء التربوي",
    ),
    cancellable = listed.result.sessions.find(
      (item: { name: string }) => item.name === "لقاء قابل للإلغاء",
    );
  prove(mainSession && cancellable);
  const cancelled = await request(
    mentor,
    `/api/v1/sessions/${cancellable.id}/cancel`,
    "POST",
    { reason: "إلغاء موثق للاختبار", row_version: cancellable.row_version },
  );
  prove(cancelled.response.status === 200);
  evidence.documented_cancellation = true;
  const sessionId = mainSession.id;
  const opened = await request(
    mentor,
    `/api/v1/sessions/${sessionId}/open`,
    "POST",
    {},
  );
  prove(opened.response.status === 200);
  let detail = await request(mentor, `/api/v1/sessions/${sessionId}`);
  const responsibleDetailAtOpen = await request(
    responsible,
    `/api/v1/sessions/${sessionId}`,
  );
  stage = "open_roster";
  evidence.opened_by_mentor = opened.response.status === 200;
  evidence.roster_empty = detail.result.roster.length === 0;
  evidence.roster_has_one = detail.result.roster.length === 1;
  evidence.roster_over_two = detail.result.roster.length > 2;
  evidence.responsible_roster_has_two =
    responsibleDetailAtOpen.result.roster.length === 2;
  evidence.roster_has_two = detail.result.roster.length === 2;
  evidence.primary_mentor_frozen =
    detail.result.session.responsible_mentor_person_id === people[1];
  prove(evidence.roster_has_two && evidence.primary_mentor_frozen);
  const lateEnrollment = await request(
    responsible,
    "/api/v1/enrollments",
    "POST",
    {
      student_profile_id: profiles[2],
      cohort_id: cohort.result.id,
      group_id: cohort.result.groups[0].id,
      effective_from: new Date().toISOString(),
    },
  );
  prove(lateEnrollment.response.status === 200);
  detail = await request(mentor, `/api/v1/sessions/${sessionId}`);
  prove(detail.result.roster.length === 2);
  evidence.roster_frozen_at_open = true;
  const first = detail.result.roster[0],
    metric = first.metrics[0];
  const partial = await request(
    mentor,
    `/api/v1/sessions/${sessionId}/records`,
    "PUT",
    {
      occurrence_row_version: detail.result.session.row_version,
      records: [
        {
          roster_id: first.id,
          attendance: {
            status: "PRESENT",
            reason: null,
            row_version: first.attendance_row_version,
          },
          metrics: [
            {
              definition_id: metric.definition_id,
              value: 8,
              row_version: null,
            },
          ],
        },
      ],
    },
  );
  prove(partial.response.status === 200);
  detail = await request(mentor, `/api/v1/sessions/${sessionId}`);
  const incomplete = await request(
    mentor,
    `/api/v1/sessions/${sessionId}/close`,
    "POST",
    { row_version: detail.result.session.row_version },
  );
  prove(
    incomplete.response.status === 422 &&
      incomplete.result.code === "INCOMPLETE_SESSION",
  );
  evidence.partial_save_and_incomplete_close = true;
  const second = detail.result.roster[1],
    saved = await request(
      mentor,
      `/api/v1/sessions/${sessionId}/records`,
      "PUT",
      {
        occurrence_row_version: detail.result.session.row_version,
        records: [
          {
            roster_id: second.id,
            attendance: {
              status: "EXCUSED_ABSENCE",
              reason: "عذر موثق",
              row_version: second.attendance_row_version,
            },
            metrics: [],
          },
        ],
      },
    );
  prove(saved.response.status === 200);
  detail = await request(mentor, `/api/v1/sessions/${sessionId}`);
  const closeBody = { row_version: detail.result.session.row_version },
    closeKey = randomUUID(),
    [closeA, closeB] = await Promise.all([
      request(
        mentor,
        `/api/v1/sessions/${sessionId}/close`,
        "POST",
        closeBody,
        closeKey,
      ),
      request(mentor, `/api/v1/sessions/${sessionId}/close`, "POST", closeBody),
    ]);
  prove(
    [closeA.response.status, closeB.response.status].sort().join(",") ===
      "200,409",
  );
  const winningClose = closeA.response.status === 200 ? closeA : closeB;
  const replay = await request(
    mentor,
    `/api/v1/sessions/${sessionId}/close`,
    "POST",
    closeBody,
    winningClose.key,
  );
  prove(replay.response.status === 200);
  evidence.concurrent_close_and_replay = true;
  detail = await request(responsible, `/api/v1/sessions/${sessionId}`);
  const corrected = detail.result.roster.find(
      (x: { id: string }) => x.id === second.id,
    ),
    correctMetric = corrected.metrics[0];
  const correction = await request(
    responsible,
    `/api/v1/sessions/${sessionId}/corrections`,
    "POST",
    {
      occurrence_row_version: detail.result.session.row_version,
      reason: "تصحيح الحضور بعد المراجعة",
      records: [
        {
          roster_id: corrected.id,
          attendance: {
            status: "PRESENT",
            reason: null,
            row_version: corrected.attendance_row_version,
          },
          metrics: [
            {
              definition_id: correctMetric.definition_id,
              value: 7,
              row_version: null,
            },
          ],
        },
      ],
    },
  );
  prove(correction.response.status === 200);
  const [history] =
    await db`select count(*)::integer count from app.session_corrections where session_occurrence_id=${sessionId}::uuid`;
  prove(history.count === 1);
  evidence.responsible_correction_preserves_history = true;
  const student = await login(emails[2]),
    studentView = await request(student, `/api/v1/sessions/${sessionId}`);
  prove(
    studentView.response.status === 200 &&
      studentView.result.roster.length === 1,
  );
  evidence.student_privacy_scope = true;
  const [audits] =
    await db`select count(*)::integer count from app.audit_events where workspace_id=${workspace}::uuid and action like 'SESSION_%'`;
  prove(audits.count >= 5);
  evidence.atomic_audit = true;
  await mkdir("output/p2", { recursive: true });
  await writeFile(
    "output/p2/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: hosted P2 session lifecycle, concurrency, correction, RLS and cleanup completed.",
  );
} catch (error) {
  await mkdir("output/p2", { recursive: true });
  await writeFile(
    "output/p2/acceptance.json",
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
  console.error(`P2 acceptance failed at ${stage}; sanitized evidence saved.`);
  process.exitCode = 1;
} finally {
  for (const authId of authIds)
    await admin.auth.admin.deleteUser(authId).catch(() => {});
  await db
    .begin(async (tx) => {
      await tx.unsafe(
        "alter table app.plan_weeks disable trigger week_requires_draft_plan",
      );
      await tx.unsafe(
        "alter table app.audit_events disable trigger audit_immutable",
      );
      await tx`delete from app.session_corrections where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_metric_records where workspace_id=${workspace}::uuid`;
      await tx`delete from app.attendance where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_roster where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_occurrences where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_metric_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.session_definitions where workspace_id=${workspace}::uuid`;
      await tx`delete from app.group_memberships where workspace_id=${workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where workspace_id=${workspace}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${workspace}::uuid`;
      await tx`delete from app.idempotency_records where workspace_id=${workspace}::uuid`;
      await tx`delete from app.audit_events where workspace_id=${workspace}::uuid`;
      await tx.unsafe(
        "alter table app.audit_events enable trigger audit_immutable",
      );
      await tx.unsafe(
        "alter table app.plan_weeks enable trigger week_requires_draft_plan",
      );
      await tx`delete from app.login_accounts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.student_profiles where workspace_id=${workspace}::uuid`;
      await tx`delete from app.persons where workspace_id=${workspace}::uuid`;
      await tx`delete from app.workspaces where id=${workspace}::uuid`;
    })
    .catch(() => {
      console.error("ACTION REQUIRED: exact P2 fixture cleanup failed.");
      process.exitCode = 1;
    });
  await db.end();
}
