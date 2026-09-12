import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheJson,
  deviceRepository,
  resetOfflineClient,
  saveAuthenticatedIdentity,
} from "../../src/offline/client";
import { CommandError, writeJson } from "../../src/offline/commands";
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
  await new MinhajOfflineDatabase().delete();
});

describe("offline commands", () => {
  it("persists attendance and updates the cached roster while fully offline", async () => {
    const scope = await saveAuthenticatedIdentity(identity);
    await cacheJson(scope.id, "/api/v1/sessions/session-1", {
      session: { id: "session-1", status: "OPEN" },
      roster: [
        {
          id: "roster-1",
          attendance_status: "NOT_RECORDED",
          reason: null,
          metrics: [
            { definition_id: "metric-1", value: null, row_version: null },
          ],
        },
      ],
    });
    vi.stubGlobal("navigator", { onLine: false });

    const result = await writeJson(
      "/api/v1/sessions/session-1/records",
      {
        records: [
          {
            roster_id: "roster-1",
            attendance: {
              status: "PRESENT",
              reason: null,
              row_version: 0,
            },
            metrics: [
              {
                definition_id: "metric-1",
                value: 9,
                row_version: null,
              },
            ],
          },
        ],
      },
      "PUT",
    );

    expect(result.queued_offline).toBe(true);
    expect(await deviceRepository().pending(scope.id)).toHaveLength(1);
    expect(
      (
        await deviceRepository().snapshot<{
          roster: Array<{
            attendance_status: string;
            metrics: Array<{ value: number }>;
          }>;
        }>(scope.id, "/api/v1/sessions/session-1")
      )?.payload.roster[0],
    ).toMatchObject({
      attendance_status: "PRESENT",
      metrics: [{ value: 9 }],
    });
  });

  it("reuses the request idempotency key if an online request becomes uncertain", async () => {
    const scope = await saveAuthenticatedIdentity(identity);
    let sentKey = "";
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_path, init: RequestInit) => {
        sentKey = String(
          (init.headers as Record<string, string>)["Idempotency-Key"],
        );
        throw new TypeError("connection lost after send");
      }),
    );

    const result = await writeJson(
      "/api/v1/tracking/entries",
      { entries: [] },
      "PUT",
    );
    const pending = await deviceRepository().pending(scope.id);

    expect(result.queued_offline).toBe(true);
    expect(pending[0].idempotencyKey).toBe(sentKey);
  });

  it("does not queue permission or validation failures", async () => {
    const scope = await saveAuthenticatedIdentity(identity);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "FORBIDDEN", message: "غير مصرح بهذه العملية." },
            { status: 403 },
          ),
        ),
    );

    await expect(
      writeJson("/api/v1/actions/action-1/verify", { row_version: 1 }),
    ).rejects.toBeInstanceOf(CommandError);
    expect(await deviceRepository().pending(scope.id)).toHaveLength(0);
  });
});
