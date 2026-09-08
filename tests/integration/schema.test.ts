import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runtimeRoleSafetySql } from "../../src/server/runtime-role";
let db: PGlite;
const w1 = randomUUID(),
  w2 = randomUUID(),
  p1 = randomUUID(),
  p2 = randomUUID(),
  a1 = randomUUID();
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.sessions(id uuid primary key,user_id uuid not null,created_at timestamptz not null default now());",
  );
  await db.exec(await readFile("db/migrations/0001_foundation.sql", "utf8"));
  await db.exec(
    await readFile("db/migrations/0002_session_context_rls.sql", "utf8"),
  );
  await db.exec(
    await readFile("db/migrations/0003_login_boundary.sql", "utf8"),
  );
  await db.exec(
    await readFile("db/migrations/0004_mentor_scope_foundation.sql", "utf8"),
  );
  await db.exec(
    await readFile("db/migrations/0005_harden_scope_visibility.sql", "utf8"),
  );
  await db.exec(
    await readFile("db/migrations/0006_program_distribution.sql", "utf8"),
  );
  await db.exec(
    await readFile("db/migrations/0007_p1_write_policies.sql", "utf8"),
  );
  await db.query(
    "insert into app.workspaces(id,name,timezone,week_starts_on) values($1,'one','Africa/Cairo',6),($2,'two','Africa/Cairo',6)",
    [w1, w2],
  );
  await db.query(
    "insert into app.persons(id,workspace_id,display_name) values($1,$2,'first'),($3,$4,'second')",
    [p1, w1, p2, w2],
  );
  await db.query(
    "insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role) values($1,$2,$3,'طالب123','STUDENT')",
    [a1, w1, p1],
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});
describe("local PostgreSQL foundation (not hosted Supabase acceptance)", () => {
  it("readiness role probe accepts the limited SQL role", async () => {
    await db.exec("set role tarbiyah_runtime");
    try {
      expect(
        (await db.query<{ safe: boolean }>(runtimeRoleSafetySql)).rows[0].safe,
      ).toBe(true);
    } finally {
      await db.exec("reset role");
    }
  });
  it("readiness role probe rejects indirect BYPASSRLS membership", async () => {
    await db.exec(
      "create role unsafe_fixture nologin bypassrls; grant unsafe_fixture to tarbiyah_runtime; set role tarbiyah_runtime",
    );
    try {
      expect(
        (await db.query<{ safe: boolean }>(runtimeRoleSafetySql)).rows[0].safe,
      ).toBe(false);
    } finally {
      await db.exec(
        "reset role; revoke unsafe_fixture from tarbiyah_runtime; drop role unsafe_fixture",
      );
    }
  });
  it("creates person without an account", async () => {
    const r = await db.query(
      "select id from app.persons where id=$1 and not exists(select 1 from app.login_accounts where person_id=$1)",
      [p2],
    );
    expect(r.rows).toHaveLength(1);
  });
  it("reserves a login on the existing person, no duplicate person", async () => {
    expect((await db.query("select id from app.persons")).rows).toHaveLength(2);
    expect(
      (
        await db.query("select id from app.login_accounts where person_id=$1", [
          p1,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("enforces global normalized-name uniqueness across workspaces", async () => {
    await expect(
      db.query(
        "insert into app.login_accounts(workspace_id,person_id,normalized_login_name,role) values($1,$2,'طالب123','STUDENT')",
        [w2, p2],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it.each(["ABC", "ab", "a b", "أحـمد", "طالب١٢٣", "a".repeat(33)])(
    "rejects noncanonical stored name %s",
    async (name) => {
      await expect(
        db.query(
          "insert into app.login_accounts(workspace_id,person_id,normalized_login_name,role) values($1,$2,$3,'STUDENT')",
          [w2, p2, name],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );
  it("rejects cross-workspace student/person links", async () => {
    await expect(
      db.query(
        "insert into app.student_profiles(workspace_id,person_id) values($1,$2)",
        [w2, p1],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("rejects ACTIVE without linked Auth identity", async () => {
    await expect(
      db.query(
        "update app.login_accounts set status='ACTIVE',temporary_password_expires_at=now()+interval '1 day' where id=$1",
        [a1],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("protects immutable username", async () => {
    await expect(
      db.query(
        "update app.login_accounts set normalized_login_name='changed' where id=$1",
        [a1],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("cannot lower the revocation cutoff", async () => {
    await db.query(
      "update app.login_accounts set revoked_before=now() where id=$1",
      [a1],
    );
    await expect(
      db.query(
        "update app.login_accounts set revoked_before=null where id=$1",
        [a1],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects invalid timezone", async () => {
    await expect(
      db.query(
        "insert into app.workspaces(name,timezone,week_starts_on) values('bad','not/a-zone',6)",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("runtime is non-owner, non-superuser and cannot bypass RLS", async () => {
    const r = await db.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owns: boolean;
    }>(
      "select rolsuper,rolbypassrls,exists(select 1 from pg_class where relowner=pg_roles.oid) as owns from pg_roles where rolname='tarbiyah_runtime'",
    );
    expect(r.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      owns: false,
    });
  });
  it("fails closed with missing or forged context using the actual limited SQL role", async () => {
    await db.exec("set role tarbiyah_runtime");
    try {
      expect((await db.query("select * from app.persons")).rows).toEqual([]);
      await db.query("select set_config('app.workspace_id',$1,false)", [w1]);
      expect((await db.query("select * from app.login_accounts")).rows).toEqual(
        [],
      );
      await expect(
        db.query("update app.login_accounts set role='RESPONSIBLE'"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role; reset app.workspace_id");
    }
  });
  it.each(["anon", "authenticated"])(
    "blocks direct Data API SQL role %s",
    async (role) => {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query("select * from app.persons"),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await db.exec("reset role");
      }
    },
  );
  it("rate bucket is atomic in PostgreSQL and not directly accessible to runtime", async () => {
    await db.exec("set role tarbiyah_runtime");
    try {
      const bucket = "a".repeat(64);
      for (let n = 1; n <= 12; n++) {
        const r = await db.query<{
          allowed: boolean;
          retry_after_seconds: number;
        }>("select * from app.reserve_login_attempt($1)", [bucket]);
        expect(r.rows[0].allowed).toBe(n <= 10);
        expect(r.rows[0].retry_after_seconds).toBeGreaterThan(0);
      }
      await expect(
        db.query("select * from app.auth_attempt_buckets"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
  it("audit is append only", async () => {
    const id = randomUUID();
    await db.query(
      "insert into app.audit_events(id,workspace_id,action,resource_type,request_id) values($1,$2,'SYSTEM_BOOTSTRAP','workspace',$3)",
      [id, w1, randomUUID()],
    );
    await expect(
      db.query("update app.audit_events set reason='overwrite' where id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("delete from app.audit_events where id=$1", [id]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("preserves a published plan and its weeks", async () => {
    const template = randomUUID();
    const plan = randomUUID();
    await db.query(
      "insert into app.program_templates(id,workspace_id,name,level) values($1,$2,'Program A','Level 1')",
      [template, w1],
    );
    await db.query(
      "insert into app.program_plans(id,workspace_id,template_id,version,name) values($1,$2,$3,1,'Program A v1')",
      [plan, w1, template],
    );
    await db.query(
      "insert into app.plan_weeks(workspace_id,plan_id,week_number,week_type,title) values($1,$2,1,'STANDARD','Week 1')",
      [w1, plan],
    );
    await db.query(
      "update app.program_plans set status='PUBLISHED' where id=$1",
      [plan],
    );
    await expect(
      db.query("update app.program_plans set name='mutated' where id=$1", [
        plan,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query("update app.plan_weeks set title='mutated' where plan_id=$1", [
        plan,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects group membership outside the enrollment cohort", async () => {
    const template = randomUUID();
    const c1 = randomUUID();
    const c2 = randomUUID();
    const group = randomUUID();
    const student = randomUUID();
    const enrollment = randomUUID();
    await db.query(
      "insert into app.program_templates(id,workspace_id,name,level) values($1,$2,'Program B','Level 2')",
      [template, w1],
    );
    await db.query(
      "insert into app.cohorts(id,workspace_id,name,source_template_id,starts_on,ends_on) values($1,$2,'C1',$3,'2026-01-01','2026-12-31'),($4,$2,'C2',$3,'2026-01-01','2026-12-31')",
      [c1, w1, template, c2],
    );
    await db.query(
      "insert into app.groups(id,workspace_id,cohort_id,name) values($1,$2,$3,'G2')",
      [group, w1, c2],
    );
    await db.query(
      "insert into app.student_profiles(id,workspace_id,person_id) values($1,$2,$3)",
      [student, w1, p1],
    );
    await db.query(
      "insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from) values($1,$2,$3,$4,now())",
      [enrollment, w1, student, c1],
    );
    await expect(
      db.query(
        "insert into app.group_memberships(workspace_id,enrollment_id,group_id,effective_from) values($1,$2,$3,now())",
        [w1, enrollment, group],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
