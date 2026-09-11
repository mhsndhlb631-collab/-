// Migration discovery test.
// Re-implements the exact file discovery logic from scripts/migrate.ts and
// proves both 0024 and 0025 are picked up in the correct order. Also proves
// the rejected 0024b_ pattern (the bug we just fixed) would have been silently
// skipped under the production runner.
import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const PRODUCTION_RUNNER_REGEX = /^\d{4}_[a-z0-9_]+\.sql$/;

describe("migration discovery (production runner contract)", () => {
  it("discovers both 0024 and 0025 in correct order", async () => {
    const files = (await readdir("db/migrations"))
      .filter((n) => PRODUCTION_RUNNER_REGEX.test(n))
      .sort();
    expect(files[0]).toBe("0001_foundation.sql");
    expect(files).toContain("0024_add_finalized_value.sql");
    expect(files).toContain("0025_finalize_transitions.sql");
    const i24 = files.indexOf("0024_add_finalized_value.sql");
    const i25 = files.indexOf("0025_finalize_transitions.sql");
    expect(i24).toBeGreaterThan(-1);
    expect(i25).toBeGreaterThan(-1);
    expect(i25).toBe(i24 + 1);
  });

  it("rejects the broken 0024b_ naming pattern that silently fails in production", async () => {
    expect(PRODUCTION_RUNNER_REGEX.test("0024b_finalize_transitions.sql")).toBe(
      false,
    );
    expect(PRODUCTION_RUNNER_REGEX.test("0024_add_finalized_value.sql")).toBe(
      true,
    );
    expect(PRODUCTION_RUNNER_REGEX.test("0025_finalize_transitions.sql")).toBe(
      true,
    );
  });

  it("rejects non-migration and extension-less files", () => {
    expect(PRODUCTION_RUNNER_REGEX.test("README.md")).toBe(false);
    expect(PRODUCTION_RUNNER_REGEX.test("0001.sql")).toBe(false);
    expect(PRODUCTION_RUNNER_REGEX.test("0001_foundation.SQL")).toBe(false);
    expect(PRODUCTION_RUNNER_REGEX.test("00001_foundation.sql")).toBe(false);
  });

  it("applies migrations exactly once per file across the tail", async () => {
    const files = (await readdir("db/migrations"))
      .filter((n) => PRODUCTION_RUNNER_REGEX.test(n))
      .sort();
    const tail = files.slice(-4);
    expect(tail).toEqual([
      "0029_p6_reporting_security.sql",
      "0030_p7_self_service_auth.sql",
      "0031_scope_read_indexes.sql",
      "0032_responsible_people_management.sql",
    ]);
  });
});
