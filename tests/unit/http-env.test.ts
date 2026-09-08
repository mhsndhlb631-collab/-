import { describe, expect, it, vi } from "vitest";
import { AppError, safeError } from "../../src/domain/errors";
import { endpoint, assertSameOrigin } from "../../src/server/http";
import { parseEnvironment, databaseUrl } from "../../src/server/env";
describe("safe HTTP boundary", () => {
  it("never returns provider/SQL errors", () => {
    const result = safeError(
      new Error("postgres://password; internal@test; secret token"),
      "id",
    );
    expect(result.status).toBe(500);
    expect(JSON.stringify(result)).not.toMatch(/password|internal@|secret/);
  });
  it("preserves a stable expected error", () =>
    expect(safeError(new AppError("VERSION_CONFLICT"), "id").status).toBe(409));
  it("returns correlated, uncached health and safe logs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await endpoint("health", async () => ({ status: "ok" }));
      const body = await response.json();
      expect(response.headers.get("x-request-id")).toBe(body.request_id);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({
        event: "request_completed",
        request_id: body.request_id,
        operation: "health",
        status: 200,
      });
    } finally {
      log.mockRestore();
    }
  });
  it("rejects absent and foreign origins", () => {
    for (const origin of [undefined, "https://evil.test"]) {
      expect(() =>
        assertSameOrigin(
          new Request("https://app.test", {
            headers: origin ? { origin } : {},
          }),
          "https://app.test",
        ),
      ).toThrow();
    }
    expect(() =>
      assertSameOrigin(
        new Request("https://app.test", {
          headers: { origin: "https://app.test" },
        }),
        "https://app.test",
      ),
    ).not.toThrow();
  });
});
describe("environment model", () => {
  it("accepts local origin", () =>
    expect(
      parseEnvironment({
        APP_ENV: "local",
        APP_ORIGIN: "http://localhost:3000",
      }).APP_ENV,
    ).toBe("local"));
  it("requires explicit environment", () =>
    expect(() => parseEnvironment({})).toThrow());
  it.each([
    "http://app.test",
    "https://user:pass@app.test",
    "https://app.test/path",
    "https://app.test?token=secret",
  ])("rejects unsafe staging origin %s", (origin) => {
    expect(() =>
      parseEnvironment({ APP_ENV: "staging", APP_ORIGIN: origin }),
    ).toThrow();
  });
  it("never falls back to migration credentials", () =>
    expect(() =>
      databaseUrl({
        MIGRATION_DATABASE_URL: "postgres://admin:secret@host/db",
      }),
    ).toThrow());
});
