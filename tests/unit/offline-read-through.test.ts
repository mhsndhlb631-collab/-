import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheJson,
  connectivity,
  OfflineReadError,
  readJson,
  resetOfflineClient,
  saveAuthenticatedIdentity,
} from "../../src/offline/client";
import { MinhajOfflineDatabase } from "../../src/offline/database";

const identity = {
  account_id: "account-1",
  workspace_id: "workspace-1",
  display_name: "مربي الاختبار",
  workspace_name: "مساحة الاختبار",
  role: "MENTOR" as const,
};

afterEach(async () => {
  vi.unstubAllGlobals();
  resetOfflineClient();
  const cleanup = new MinhajOfflineDatabase();
  await cleanup.delete();
});

describe("offline read-through", () => {
  it("opens a previously synchronized resource after a network failure", async () => {
    const scope = await saveAuthenticatedIdentity(identity);
    await cacheJson(scope.id, "/api/v1/sessions", {
      sessions: [{ id: "session-1" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const result = await readJson<{ sessions: { id: string }[] }>(
      "/api/v1/sessions",
    );

    expect(result.source).toBe("device");
    expect(result.data.sessions[0].id).toBe("session-1");
  });

  it("does not treat a real 401 as offline or reveal cached data", async () => {
    const scope = await saveAuthenticatedIdentity(identity);
    await cacheJson(scope.id, "/api/v1/programs", { cohorts: ["cached"] });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );

    await expect(readJson("/api/v1/programs")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    } satisfies Partial<OfflineReadError>);
    expect(connectivity.current().kind).toBe("auth_required");
  });

  it("may show cached data during a server outage but reports server_error", async () => {
    const scope = await saveAuthenticatedIdentity(identity);
    await cacheJson(scope.id, "/api/v1/people", { students: ["cached"] });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );

    const result = await readJson<{ students: string[] }>("/api/v1/people");

    expect(result).toMatchObject({
      source: "device",
      data: { students: ["cached"] },
    });
    expect(connectivity.current().kind).toBe("server_error");
  });
});
