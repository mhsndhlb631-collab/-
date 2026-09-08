import { describe, expect, it } from "vitest";
import { deriveRuntimeDatabaseUrl } from "../../src/server/runtime-url";

describe("Supabase runtime URL derivation", () => {
  const migrationUrl =
    "postgresql://postgres.abcdefghijklmnopqrst:admin-secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
  it("switches to the limited login and transaction pooler without preserving admin credentials", () => {
    const result = new URL(
      deriveRuntimeDatabaseUrl({
        migrationUrl,
        runtimePassword: "runtime-password-that-is-long-enough",
      }),
    );
    expect(decodeURIComponent(result.username)).toBe(
      "tarbiyah_app_runtime.abcdefghijklmnopqrst",
    );
    expect(result.password).toBe("runtime-password-that-is-long-enough");
    expect(result.password).not.toBe("admin-secret");
    expect(result.port).toBe("6543");
  });
  it.each([
    "postgresql://postgres.abcdefghijklmnopqrst:secret@evil.example:5432/postgres",
    "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
    "postgresql://wrong.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres",
  ])("rejects an unexpected migration URI %s", (value) => {
    expect(() =>
      deriveRuntimeDatabaseUrl({
        migrationUrl: value,
        runtimePassword: "runtime-password-that-is-long-enough",
      }),
    ).toThrow();
  });
});
