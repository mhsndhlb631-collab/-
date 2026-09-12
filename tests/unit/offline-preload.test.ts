import { describe, expect, it } from "vitest";
import { offlinePreloadPaths } from "../../src/offline/preload";

const sessions = Array.from({ length: 15 }, (_, index) => ({
  id: `session-${index}`,
  starts_at: new Date(2026, 8, index + 1).toISOString(),
  status: index === 14 ? "OPEN" : index > 10 ? "PLANNED" : "CLOSED",
}));

describe("offline daily dataset", () => {
  it("preloads the student's daily, learning, tracking, and journey views", () => {
    const paths = offlinePreloadPaths("STUDENT", sessions);
    expect(paths).toContain("/api/v1/me/today");
    expect(paths).toContain("/api/v1/learning");
    expect(
      paths.some((path) => path.startsWith("/api/v1/tracking/expected")),
    ).toBe(true);
    expect(paths).not.toContain("/api/v1/people");
  });

  it("preloads staff follow-up queues without exposing responsible-only people", () => {
    const paths = offlinePreloadPaths("MENTOR", sessions);
    expect(paths).toContain("/api/v1/attention");
    expect(paths).toContain("/api/v1/actions");
    expect(paths).not.toContain("/api/v1/people");
  });

  it("keeps detailed session preloading deliberately bounded", () => {
    const paths = offlinePreloadPaths("RESPONSIBLE", sessions);
    const details = paths.filter((path) =>
      /^\/api\/v1\/sessions\/[^/]+$/.test(path),
    );
    expect(details).toHaveLength(12);
    expect(details[0]).toBe("/api/v1/sessions/session-14");
    expect(paths).toContain("/api/v1/people");
  });
});
