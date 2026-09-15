import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;

describe("mentor operations schema", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "create role anon; create role authenticated; create schema auth; create table auth.sessions(id uuid primary key,user_id uuid not null,created_at timestamptz not null default now());",
    );
    const migrations = (await readdir("db/migrations"))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    for (const migration of migrations)
      await db.exec(await readFile(`db/migrations/${migration}`, "utf8"));
  }, 30_000);

  afterAll(async () => db.close());

  it("extends the canonical assignment definition", async () => {
    const result = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='app' and table_name='assignment_definitions' and column_name in ('group_id','measurement_mode','recurrence','pass_score') order by column_name",
    );
    expect(result.rows.map((row) => row.column_name)).toEqual([
      "group_id",
      "measurement_mode",
      "pass_score",
      "recurrence",
    ]);
  });

  it("creates occurrence, target, evaluation, revision, and note records", async () => {
    const result = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='app' and table_name like 'assignment_%' order by table_name",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "assignment_targets",
        "assignment_occurrences",
        "assignment_evaluations",
        "assignment_evaluation_revisions",
        "assignment_evaluation_notes",
      ]),
    );
  });

  it("forces row-level security on every new operational table", async () => {
    const result = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='app' and relname in ('assignment_targets','assignment_occurrences','assignment_evaluations','assignment_evaluation_revisions','assignment_evaluation_notes')",
    );
    expect(result.rows).toHaveLength(5);
    expect(
      result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity),
    ).toBe(true);
  });
});
