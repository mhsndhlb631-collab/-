import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { z } from "zod";

const parsed = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(20),
    MIGRATION_DATABASE_URL: z.string().startsWith("postgres"),
    AUTH_INTERNAL_EMAIL_DOMAIN: z.string().min(4),
    HOSTED_ORIGIN: z.url().optional(),
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error("BLOCKED: P7 acceptance environment is incomplete.");
  process.exit(1);
}
const env = parsed.data,
  origin = env.HOSTED_ORIGIN ?? "https://tarbiyah-operations.vercel.app",
  admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  db = postgres(env.MIGRATION_DATABASE_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 8,
  }),
  workspace = randomUUID(),
  outsiderWorkspace = randomUUID(),
  people = Array.from({ length: 5 }, () => randomUUID()),
  accounts = Array.from({ length: 5 }, () => randomUUID()),
  authIds: string[] = [],
  profile = randomUUID(),
  template = randomUUID(),
  cohort = randomUUID(),
  plan = randomUUID(),
  week = randomUUID(),
  group = randomUUID(),
  enrollment = randomUUID(),
  password = randomBytes(24).toString("base64url"),
  newPassword = randomBytes(25).toString("base64url"),
  evidence: Record<string, boolean> = {};
let stage = "bootstrap",
  lastHttp: { status: number; code?: string; request_id?: string } | null =
    null;
type SafeJson = {
  code?: string;
  request_id?: string;
  next?: string;
  role?: string;
  display_name?: string;
  counts?: Record<string, unknown>;
  groups?: unknown[];
  text?: string;
  [key: string]: unknown;
};
function prove(value: unknown): asserts value {
  if (!value) throw new Error(`acceptance assertion failed: ${stage}`);
}
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}
async function http(
  path: string,
  options: { cookie?: string; method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Origin: origin,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let result: SafeJson = {};
  try {
    result = JSON.parse(text);
  } catch {
    result = { text };
  }
  lastHttp = {
    status: response.status,
    code: result.code,
    request_id: result.request_id,
  };
  return { status: response.status, result, response };
}
async function identity(
  i: number,
  role: "RESPONSIBLE" | "MENTOR" | "STUDENT",
  forced = false,
) {
  const created = await admin.auth.admin.createUser({
    email: `${accounts[i]}@${env.AUTH_INTERNAL_EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  });
  prove(!created.error && created.data.user);
  authIds.push(created.data.user.id);
  await db`insert into app.login_accounts(id,workspace_id,person_id,supabase_auth_user_id,normalized_login_name,role,status,must_change_password,temporary_password_expires_at)
    values(${accounts[i]}::uuid,${i === 4 ? outsiderWorkspace : workspace}::uuid,${people[i]}::uuid,${created.data.user.id}::uuid,
      ${`p7_${accounts[i].replaceAll("-", "").slice(0, 12)}`},${role}::app.account_role,'ACTIVE',${forced},${forced ? new Date(Date.now() + 86400000).toISOString() : null}::timestamptz)`;
}
async function login(i: number, selectedPassword = password) {
  const result = await http("/api/v1/auth/login", {
    method: "POST",
    body: {
      login_name: `p7_${accounts[i].replaceAll("-", "").slice(0, 12)}`,
      password: selectedPassword,
    },
  });
  return { ...result, cookie: cookieFrom(result.response) };
}

try {
  stage = "fixtures";
  await db.begin(async (tx) => {
    await tx`insert into app.workspaces(id,name,timezone,week_starts_on) values(${workspace}::uuid,'P7 acceptance','Africa/Cairo',6),(${outsiderWorkspace}::uuid,'P7 isolated','Africa/Cairo',6)`;
    for (let i = 0; i < people.length; i++)
      await tx`insert into app.persons(id,workspace_id,display_name) values(${people[i]}::uuid,${i === 4 ? outsiderWorkspace : workspace}::uuid,${`P7 Person ${i}`})`;
    await tx`insert into app.student_profiles(id,workspace_id,person_id) values(${profile}::uuid,${workspace}::uuid,${people[2]}::uuid)`;
  });
  await identity(0, "RESPONSIBLE");
  await identity(1, "MENTOR");
  await identity(2, "STUDENT");
  await identity(3, "STUDENT", true);
  await identity(4, "RESPONSIBLE");
  await db.begin(async (tx) => {
    await tx`insert into app.program_templates(id,workspace_id,name,level,status) values(${template}::uuid,${workspace}::uuid,'P7 template','L1','ACTIVE')`;
    await tx`insert into app.cohorts(id,workspace_id,name,source_template_id,starts_on,ends_on,status) values(${cohort}::uuid,${workspace}::uuid,'P7 cohort',${template}::uuid,current_date-10,current_date+60,'ACTIVE')`;
    await tx`insert into app.program_plans(id,workspace_id,cohort_id,version,name,status) values(${plan}::uuid,${workspace}::uuid,${cohort}::uuid,1,'P7 plan','DRAFT')`;
    await tx`insert into app.plan_weeks(id,workspace_id,plan_id,week_number,week_type,title) values(${week}::uuid,${workspace}::uuid,${plan}::uuid,1,'STANDARD','P7 week')`;
    await tx`insert into app.groups(id,workspace_id,cohort_id,name) values(${group}::uuid,${workspace}::uuid,${cohort}::uuid,'P7 group')`;
    await tx`insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from) values(${enrollment}::uuid,${workspace}::uuid,${profile}::uuid,${cohort}::uuid,clock_timestamp()-interval '10 days')`;
    await tx`insert into app.group_memberships(workspace_id,enrollment_id,group_id,effective_from) values(${workspace}::uuid,${enrollment}::uuid,${group}::uuid,clock_timestamp()-interval '10 days')`;
    await tx`insert into app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from) values(${workspace}::uuid,${group}::uuid,${people[1]}::uuid,clock_timestamp()-interval '10 days')`;
    await tx`update app.program_plans set status='PUBLISHED' where id=${plan}::uuid`;
    await tx`update app.cohorts set current_plan_id=${plan}::uuid where id=${cohort}::uuid`;
  });
  stage = "identity_and_role_journeys";
  const sessions = [];
  for (const index of [0, 1, 2, 4]) sessions.push(await login(index));
  prove(
    sessions.every(
      (item) =>
        item.status === 200 &&
        item.result.next === "APP" &&
        item.cookie.includes("tarbiyah-access"),
    ),
  );
  for (const [i, role] of [
    [0, "RESPONSIBLE"],
    [1, "MENTOR"],
    [2, "STUDENT"],
  ] as const) {
    const me = await http("/api/v1/me", { cookie: sessions[i].cookie });
    prove(
      me.status === 200 &&
        me.result.role === role &&
        me.result.display_name === `P7 Person ${i}` &&
        !JSON.stringify(me.result).includes("supabase_auth"),
    );
    for (const page of ["today", "program", "progress"]) {
      const result = await http(`/api/v1/me/${page}`, {
        cookie: sessions[i].cookie,
      });
      prove(result.status === 200 && result.result.role === role);
      if (role === "STUDENT" && page === "today")
        prove(
          !!result.result.counts &&
            !("attentions" in result.result.counts) &&
            !("actions" in result.result.counts),
        );
    }
  }
  evidence.identity_and_three_role_journeys = true;
  stage = "scope_and_private_fields";
  const studentProgram = await http("/api/v1/me/program", {
      cookie: sessions[2].cookie,
    }),
    outsiderProgram = await http("/api/v1/me/program", {
      cookie: sessions[3].cookie,
    });
  prove(
    studentProgram.result.groups?.length === 1 &&
      outsiderProgram.result.groups?.length === 0,
  );
  const mentorReport = await http(
    `/api/v1/mentors/${accounts[1]}/performance?from=2026-09-01&to=2026-09-10`,
    { cookie: sessions[1].cookie },
  );
  const studentAudit = await http("/api/v1/audit-events", {
    cookie: sessions[2].cookie,
  });
  prove(mentorReport.status === 403 && studentAudit.status === 403);
  evidence.role_scope_cross_workspace_and_private_dtos = true;
  stage = "forced_password_change";
  const forced = await login(3);
  prove(forced.status === 200 && forced.result.next === "CHANGE_PASSWORD");
  prove((await http("/api/v1/me", { cookie: forced.cookie })).status === 401);
  const changed = await http("/api/v1/auth/change-password", {
    cookie: forced.cookie,
    method: "POST",
    body: { current_password: password, new_password: newPassword },
  });
  prove(
    changed.status === 200 &&
      changed.result.next === "LOGIN" &&
      changed.response.headers
        .getSetCookie()
        .every((value) => value.includes("Max-Age=0")),
  );
  prove((await http("/api/v1/me", { cookie: forced.cookie })).status === 401);
  prove((await login(3, password)).status === 401);
  const fresh = await login(3, newPassword);
  prove(fresh.status === 200 && fresh.result.next === "APP");
  const audit = await db<
    { count: number }[]
  >`select count(*)::int count from app.audit_events where workspace_id=${workspace}::uuid and actor_account_id=${accounts[3]}::uuid and action='OWN_PASSWORD_CHANGED'`;
  prove(audit[0]?.count === 1);
  evidence.password_change_revoke_relogin_and_audit = true;
  stage = "logout";
  const logout = await http("/api/v1/auth/logout", {
    cookie: sessions[2].cookie,
    method: "POST",
  });
  prove(
    logout.status === 200 &&
      logout.response.headers.getSetCookie().length === 2 &&
      logout.response.headers
        .getSetCookie()
        .every((value) => value.includes("Max-Age=0")),
  );
  prove(
    (await http("/api/v1/me", { cookie: sessions[2].cookie })).status === 401,
  );
  evidence.logout_clears_and_invalidates = true;
  stage = "rtl_mobile_accessibility_contract";
  const page = await fetch(origin),
    html = await page.text();
  prove(
    page.status === 200 &&
      html.includes('lang="ar"') &&
      html.includes('dir="rtl"'),
  );
  const cssLinks = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map(
    (match) => new URL(match[1], origin).toString(),
  );
  const css = (
    await Promise.all(cssLinks.map(async (url) => (await fetch(url)).text()))
  ).join("\n");
  prove(
    css.includes("focus-visible") &&
      css.includes("max-width:480px") &&
      css.includes("role-nav"),
  );
  evidence.rtl_mobile_keyboard_and_state_contract = true;
  await mkdir("output/p7", { recursive: true });
  await writeFile(
    "output/p7/acceptance.json",
    JSON.stringify(
      { result: "PASS", at: new Date().toISOString(), evidence },
      null,
      2,
    ),
  );
  console.log(
    "PASS: hosted P7 role journeys, self-service auth, RTL/accessibility contract and isolation completed.",
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
  await mkdir("output/p7", { recursive: true });
  await writeFile(
    "output/p7/acceptance.json",
    JSON.stringify(
      { result: "FAIL", stage, evidence, diagnostic, http: lastHttp },
      null,
      2,
    ),
  );
  console.error(`P7 acceptance failed at ${stage}.`);
  process.exitCode = 1;
} finally {
  try {
    await db.begin(async (tx) => {
      await tx`alter table app.audit_events disable trigger audit_immutable`;
      await tx`alter table app.plan_weeks disable trigger week_requires_draft_plan`;
      await tx`alter table app.program_plans disable trigger plan_immutable`;
      await tx`delete from app.audit_events where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.idempotency_records where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.group_memberships where workspace_id=${workspace}::uuid`;
      await tx`delete from app.mentor_assignments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.enrollments where workspace_id=${workspace}::uuid`;
      await tx`delete from app.groups where workspace_id=${workspace}::uuid`;
      await tx`update app.cohorts set current_plan_id=null where workspace_id=${workspace}::uuid`;
      await tx`delete from app.plan_weeks where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_plans where workspace_id=${workspace}::uuid`;
      await tx`delete from app.cohorts where workspace_id=${workspace}::uuid`;
      await tx`delete from app.program_templates where workspace_id=${workspace}::uuid`;
      await tx`delete from app.login_accounts where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.student_profiles where workspace_id=${workspace}::uuid`;
      await tx`delete from app.persons where workspace_id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`delete from app.workspaces where id in (${workspace}::uuid,${outsiderWorkspace}::uuid)`;
      await tx`alter table app.audit_events enable trigger audit_immutable`;
      await tx`alter table app.plan_weeks enable trigger week_requires_draft_plan`;
      await tx`alter table app.program_plans enable trigger plan_immutable`;
    });
    for (const authId of authIds) await admin.auth.admin.deleteUser(authId);
  } catch {
    console.error("ACTION REQUIRED: P7 fixture cleanup failed safely.");
    process.exitCode = 1;
  }
  await db.end();
}
