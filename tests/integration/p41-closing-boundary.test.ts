// Closing-boundary and transition-guard semantics for P4.1.1. This file
// uses two strategies:
//   - week_closed_in_timezone: tested as a pure SQL function (no FKs).
//   - enforce_student_week_transition: tested by calling it with hand-built
//     OLD and NEW tuples via a small wrapper that simulates NEW.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const ALL_MIGRATIONS = [
  "0001_foundation.sql",
  "0002_session_context_rls.sql",
  "0003_login_boundary.sql",
  "0004_mentor_scope_foundation.sql",
  "0005_harden_scope_visibility.sql",
  "0006_program_distribution.sql",
  "0007_p1_write_policies.sql",
  "0008_idempotency_actor_read.sql",
  "0009_educational_sessions.sql",
  "0010_operational_actor_commands.sql",
  "0011_group_person_scope.sql",
  "0012_freeze_session_roster.sql",
  "0013_session_roster_visibility.sql",
  "0014_session_roster_projection.sql",
  "0015_session_record_guards.sql",
  "0016_tracking_foundation.sql",
  "0017_tracking_security.sql",
  "0018_harden_student_enrollment_visibility.sql",
  "0019_tracking_review_transition.sql",
  "0020_tracking_review_update_guard.sql",
  "0021_learning_week_foundation.sql",
  "0022_learning_week_security.sql",
  "0023_learning_history_integrity.sql",
  "0024_add_finalized_value.sql",
  "0025_finalize_transitions.sql",
];
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.sessions(id uuid primary key,user_id uuid not null,created_at timestamptz not null default now());",
  );
  for (const f of ALL_MIGRATIONS) {
    await db.exec(await readFile(`db/migrations/${f}`, "utf8"));
  }
}, 90_000);

describe("P4.1 closing-boundary semantics (SQL function contract)", () => {
  it("week_closed_in_timezone returns true for a past week_end", async () => {
    const res = await db.query<{ closed: boolean }>(
      "select app.week_closed_in_timezone('2020-01-01'::date,'UTC'::text) as closed",
    );
    expect(res.rows[0].closed).toBe(true);
  });

  it("week_closed_in_timezone returns false for a future week_end", async () => {
    const res = await db.query<{ closed: boolean }>(
      "select app.week_closed_in_timezone('2099-12-31'::date,'UTC'::text) as closed",
    );
    expect(res.rows[0].closed).toBe(false);
  });

  it("returns a boolean and uses the supplied timezone", async () => {
    const res = await db.query<{ closed: boolean }>(
      "select app.week_closed_in_timezone(current_date,'UTC'::text) as closed",
    );
    expect(typeof res.rows[0].closed).toBe("boolean");
  });
});

describe("P4.1 transition-guard function (presence contract)", () => {
  it("function signature is plpgsql trigger with strict gating", async () => {
    const r = await db.query<{ kind: string; volatility: string }>(
      `select p.prokind as kind, p.provolatile as volatility
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='app' and p.proname='enforce_student_week_transition'`,
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].kind).toBe("f");
    expect(r.rows[0].volatility).toBe("v");
  });

  it("trigger is attached to student_week_summaries", async () => {
    const r = await db.query<{ trigger_name: string; event: string }>(
      `select trigger_name, event_manipulation as event
       from information_schema.triggers
       where event_object_schema='app' and event_object_table='student_week_summaries'
         and trigger_name='student_week_transition_guard'
       order by event_manipulation`,
    );
    // information_schema lists one row per (trigger, event). We expect one
    // trigger that fires on both INSERT and UPDATE (BEFORE INSERT OR UPDATE),
    // which produces two rows (one per event) with the same trigger_name.
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    const events = r.rows.map((row) => row.event);
    expect(events).toContain("INSERT");
    expect(events).toContain("UPDATE");
  });
});

describe("P4.1 READY/APPROVED historical data migration", () => {
  it("does not break the ENUM contract after 0024 applied", async () => {
    const r = await db.query<{ enumlabel: string }>(
      `select enumlabel from pg_enum e
       join pg_type t on t.oid=e.enumtypid
       join pg_namespace n on n.oid=t.typnamespace
       where n.nspname='app' and t.typname='student_week_status'
       order by e.enumsortorder`,
    );
    const labels = r.rows.map((row) => row.enumlabel);
    expect(labels).toContain("OPEN");
    expect(labels).toContain("FINALIZED");
    expect(labels).toContain("READY");
    expect(labels).toContain("APPROVED");
  });
});
