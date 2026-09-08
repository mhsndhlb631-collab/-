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
  console.error("BLOCKED: P1 acceptance environment is incomplete.");
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
const ids = {
  workspace: randomUUID(),
  people: [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ],
  profiles: [randomUUID(), randomUUID()],
  accounts: [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ],
};
const roles = [
  "RESPONSIBLE",
  "MENTOR",
  "MENTOR",
  "STUDENT",
  "STUDENT",
] as const;
const authIds: string[] = [];
const password = randomBytes(24).toString("base64url");
const evidence: Record<string, boolean> = {};
let stage = "bootstrap";
function prove(value: unknown): asserts value {
  if (!value) throw new Error("acceptance assertion failed");
}
async function identity(index: number) {
  const email = `${ids.accounts[index]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ban_duration: "876000h",
  });
  prove(!created.error && created.data.user);
  authIds.push(created.data.user.id);
  await db`update app.login_accounts set supabase_auth_user_id=${created.data.user.id}::uuid where id=${ids.accounts[index]}::uuid`;
  const active = await admin.auth.admin.updateUserById(created.data.user.id, {
    ban_duration: "none",
  });
  prove(!active.error);
  await db`update app.login_accounts set status='ACTIVE',must_change_password=false where id=${ids.accounts[index]}::uuid`;
  return email;
}
async function login(email: string) {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      login_name: `p1_${ids.accounts.findIndex((value) => `${value}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}` === email)}`,
      password,
    }),
  });
  prove(response.status === 200);
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  prove(
    cookies.includes("tarbiyah-access") && cookies.includes("tarbiyah-refresh"),
  );
  return cookies;
}
async function command(
  cookie: string,
  path: string,
  body: unknown,
  key = randomUUID(),
) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  return { response, result, key };
}
async function overview(cookie: string) {
  const response = await fetch(`${origin}/api/v1/programs`, {
    headers: { Cookie: cookie },
  });
  prove(response.status === 200);
  return response.json() as Promise<{
    templates: { id: string }[];
    plans: { id: string }[];
    cohorts: { id: string; groups: { id: string }[] }[];
  }>;
}

try {
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${ids.workspace}::uuid,'P1 acceptance','Africa/Cairo',6)`;
    for (let i = 0; i < ids.people.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${ids.people[i]}::uuid,${ids.workspace}::uuid,${`P1 Person ${i}`})`;
    for (let i = 0; i < 2; i++)
      await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${ids.profiles[i]}::uuid,${ids.workspace}::uuid,${ids.people[i + 3]}::uuid)`;
    for (let i = 0; i < ids.accounts.length; i++)
      await tx`insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role) values(${ids.accounts[i]}::uuid,${ids.workspace}::uuid,${ids.people[i]}::uuid,${`p1_${i}`},${roles[i]})`;
  });
  const emails = [];
  for (let i = 0; i < ids.accounts.length; i++) emails.push(await identity(i));
  evidence.safe_identity_provisioning = true;
  const responsibleCookie = await login(emails[0]);
  stage = "programs";
  const templateA = await command(
    responsibleCookie,
    "/api/v1/program-templates",
    { name: "برنامج البناء", level: "تمهيدي" },
  );
  prove(templateA.response.status === 200);
  const replay = await command(
    responsibleCookie,
    "/api/v1/program-templates",
    { name: "برنامج البناء", level: "تمهيدي" },
    templateA.key,
  );
  prove(
    replay.response.status === 200 && replay.result.id === templateA.result.id,
  );
  const conflict = await command(
    responsibleCookie,
    "/api/v1/program-templates",
    { name: "مختلف", level: "تمهيدي" },
    templateA.key,
  );
  prove(conflict.response.status === 409);
  evidence.idempotency_replay_and_conflict = true;
  const templateB = await command(
    responsibleCookie,
    "/api/v1/program-templates",
    { name: "برنامج التدرج", level: "متقدم" },
  );
  prove(templateB.response.status === 200);
  const weeksA = [1, 2].map((n) => ({
    week_number: n,
    week_type: "STANDARD",
    title: `بناء ${n}`,
    objectives: ["هدف تأسيسي"],
  }));
  const weeksB = [1, 2, 3, 4].map((n) => ({
    week_number: n,
    week_type: n === 4 ? "EXAM" : "STANDARD",
    title: `تدرج ${n}`,
    objectives: ["هدف متدرج"],
  }));
  const planA = await command(
    responsibleCookie,
    `/api/v1/program-templates/${templateA.result.id}/plans`,
    { name: "خطة البناء 1", weeks: weeksA },
  );
  const planB = await command(
    responsibleCookie,
    `/api/v1/program-templates/${templateB.result.id}/plans`,
    { name: "خطة التدرج 1", weeks: weeksB },
  );
  prove(planA.response.status === 200 && planB.response.status === 200);
  evidence.two_materially_different_programs = true;
  const cohortA = await command(responsibleCookie, "/api/v1/cohorts", {
    name: "دفعة البناء",
    source_plan_id: planA.result.id,
    starts_on: "2026-09-01",
    ends_on: "2027-06-30",
    groups: ["مجموعة ألف", "مجموعة باء"],
  });
  const cohortB = await command(responsibleCookie, "/api/v1/cohorts", {
    name: "دفعة التدرج",
    source_plan_id: planB.result.id,
    starts_on: "2026-10-01",
    ends_on: "2027-07-31",
    groups: ["مجموعة جيم"],
  });
  prove(cohortA.response.status === 200 && cohortB.response.status === 200);
  const planA2 = await command(
    responsibleCookie,
    `/api/v1/program-templates/${templateA.result.id}/plans`,
    {
      name: "خطة البناء 2",
      weeks: [
        ...weeksA,
        {
          week_number: 3,
          week_type: "CUSTOM",
          title: "إضافة لاحقة",
          objectives: ["هدف جديد"],
        },
      ],
    },
  );
  prove(planA2.response.status === 200);
  const [copy] =
    await db`select p.copied_from_plan_id,(select count(*)::integer from app.plan_weeks w where w.plan_id=p.id) as weeks from app.program_plans p where p.id=${cohortA.result.plan_id}::uuid`;
  prove(copy.copied_from_plan_id === planA.result.id && copy.weeks === 2);
  evidence.cohort_copy_is_historically_stable = true;
  const past2 = new Date(Date.now() - 7200000).toISOString(),
    past1 = new Date(Date.now() - 3600000).toISOString();
  const enrollment1 = await command(responsibleCookie, "/api/v1/enrollments", {
    student_profile_id: ids.profiles[0],
    cohort_id: cohortA.result.id,
    group_id: cohortA.result.groups[0].id,
    effective_from: past2,
  });
  const enrollment2 = await command(responsibleCookie, "/api/v1/enrollments", {
    student_profile_id: ids.profiles[1],
    cohort_id: cohortB.result.id,
    group_id: cohortB.result.groups[0].id,
    effective_from: past2,
  });
  prove(
    enrollment1.response.status === 200 && enrollment2.response.status === 200,
  );
  prove(
    (
      await command(responsibleCookie, "/api/v1/group-memberships", {
        enrollment_id: enrollment1.result.id,
        group_id: cohortA.result.groups[1].id,
        effective_at: past1,
      })
    ).response.status === 200,
  );
  prove(
    (
      await command(responsibleCookie, "/api/v1/mentor-assignments", {
        group_id: cohortA.result.groups[1].id,
        mentor_person_id: ids.people[1],
        effective_at: past2,
      })
    ).response.status === 200,
  );
  prove(
    (
      await command(responsibleCookie, "/api/v1/mentor-assignments", {
        group_id: cohortA.result.groups[1].id,
        mentor_person_id: ids.people[2],
        effective_at: past1,
      })
    ).response.status === 200,
  );
  prove(
    (
      await command(responsibleCookie, "/api/v1/mentor-assignments", {
        group_id: cohortB.result.groups[0].id,
        mentor_person_id: ids.people[1],
        effective_at: past2,
      })
    ).response.status === 200,
  );
  evidence.membership_and_mentor_history_preserved = true;
  const mentor1 = await overview(await login(emails[1])),
    mentor2 = await overview(await login(emails[2])),
    student1 = await overview(await login(emails[3])),
    student2 = await overview(await login(emails[4]));
  prove(
    mentor1.templates.length === 0 &&
      mentor1.cohorts.length === 1 &&
      mentor1.cohorts[0].id === cohortB.result.id,
  );
  prove(
    mentor2.templates.length === 0 &&
      mentor2.cohorts.length === 1 &&
      mentor2.cohorts[0].id === cohortA.result.id,
  );
  prove(
    student1.cohorts.length === 1 &&
      student1.cohorts[0].groups[0].id === cohortA.result.groups[1].id,
  );
  prove(
    student2.cohorts.length === 1 &&
      student2.cohorts[0].id === cohortB.result.id,
  );
  evidence.role_and_assignment_scope = true;
  const [audit] =
    await db`select count(*)::integer as count from app.audit_events where workspace_id=${ids.workspace}::uuid and action like 'P1_%' or workspace_id=${ids.workspace}::uuid and action in ('PROGRAM_TEMPLATE_CREATED','PROGRAM_PLAN_PUBLISHED','COHORT_CREATED','STUDENT_ENROLLED','STUDENT_GROUP_MOVED','MENTOR_ASSIGNED')`;
  prove(audit.count >= 12);
  evidence.atomic_audit = true;
  await mkdir("output/p1", { recursive: true });
  await writeFile(
    "output/p1/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real P1 programs, immutable copies, distribution history, RLS and hosted APIs completed.",
  );
} catch (error) {
  await mkdir("output/p1", { recursive: true });
  await writeFile(
    "output/p1/acceptance.json",
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
  console.error(`P1 acceptance failed at ${stage}; sanitized evidence saved.`);
  process.exitCode = 1;
} finally {
  for (const authId of authIds)
    await admin.auth.admin.deleteUser(authId).catch(() => {});
  await db
    .begin(async (tx) => {
      await tx`delete from app.group_memberships where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${ids.workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.idempotency_records where workspace_id=${ids.workspace}::uuid`;
      await tx.unsafe(
        "alter table app.audit_events disable trigger audit_immutable",
      );
      await tx`delete from app.audit_events where workspace_id=${ids.workspace}::uuid`;
      await tx.unsafe(
        "alter table app.audit_events enable trigger audit_immutable",
      );
      await tx`delete from app.login_accounts where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.student_profiles where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.persons where workspace_id=${ids.workspace}::uuid`;
      await tx`delete from app.workspaces where id=${ids.workspace}::uuid`;
    })
    .catch(() => {
      console.error("ACTION REQUIRED: P1 fixture cleanup failed.");
      process.exitCode = 1;
    });
  await db.end();
}
