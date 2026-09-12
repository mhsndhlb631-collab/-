import { randomUUID } from "node:crypto";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinhajOfflineDatabase } from "../../src/offline/database";
import { OfflineRepository } from "../../src/offline/repository";
import { retryAt, SyncManager } from "../../src/offline/sync-manager";

const databases: MinhajOfflineDatabase[] = [];
function setup() {
  const db = new MinhajOfflineDatabase(`sync-test-${randomUUID()}`, {
    indexedDB,
    IDBKeyRange,
  });
  databases.push(db);
  return { db, repository: new OfflineRepository(db) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) {
    await db.delete();
  }
});

const mutation = {
  scopeId: "scope-1",
  entityType: "attendance",
  entityId: "roster-1",
  operation: "UPDATE" as const,
  command: "P2_SAVE_SESSION_RECORDS",
  method: "PUT" as const,
  path: "/api/v1/sessions/session-1/records",
  payload: { records: [] },
  dependencies: [] as string[],
};

describe("SyncManager", () => {
  it("acknowledges a mutation exactly once and records the request id", async () => {
    const { db, repository } = setup();
    await repository.enqueue({
      ...mutation,
      id: "m1",
      idempotencyKey: "key-1",
    });
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { id: "server-record-1" },
      requestId: "request-1",
    });

    const manager = new SyncManager(repository, transport);
    await manager.run("scope-1");
    await manager.run("scope-1");

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].idempotencyKey).toBe("key-1");
    expect(await db.outbox.get("m1")).toMatchObject({
      status: "synced",
      requestId: "request-1",
    });
    expect(await repository.resolveServerId("scope-1", "roster-1")).toBe(
      "server-record-1",
    );
  });

  it("retains the same mutation and key after an uncertain network failure", async () => {
    const { db, repository } = setup();
    await repository.enqueue({
      ...mutation,
      id: "m1",
      idempotencyKey: "key-1",
    });
    const manager = new SyncManager(
      repository,
      vi.fn().mockRejectedValue(new Error("timeout")),
    );

    await manager.run("scope-1");

    expect(await db.outbox.get("m1")).toMatchObject({
      status: "pending",
      idempotencyKey: "key-1",
      attempts: 1,
      error: { code: "NETWORK_FAILURE" },
    });
  });

  it("waits for a parent acknowledgement before sending its child", async () => {
    const { repository } = setup();
    await repository.enqueue({
      ...mutation,
      id: "parent",
      entityType: "session",
      entityId: "local-session",
      operation: "CREATE",
    });
    await repository.enqueue({
      ...mutation,
      id: "child",
      entityId: "local-attendance",
      dependencies: ["parent"],
    });
    const sent: string[] = [];
    const manager = new SyncManager(repository, async (item) => {
      sent.push(item.id);
      return {
        ok: true,
        status: 200,
        body: {
          id: item.id === "parent" ? "server-session" : "server-attendance",
        },
        requestId: `request-${item.id}`,
      };
    });

    await manager.run("scope-1");

    expect(sent).toEqual(["parent", "child"]);
  });

  it("classifies version conflicts and does not retry them", async () => {
    const { db, repository } = setup();
    await repository.enqueue({ ...mutation, id: "conflicted" });
    const transport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      body: { code: "VERSION_CONFLICT", message: "conflict" },
      requestId: "request-conflict",
    });
    const manager = new SyncManager(repository, transport);

    await manager.run("scope-1");
    await manager.run("scope-1");

    expect(transport).toHaveBeenCalledTimes(1);
    expect(await db.outbox.get("conflicted")).toMatchObject({
      status: "conflict",
      error: { code: "VERSION_CONFLICT", httpStatus: 409 },
    });
  });

  it("uses bounded deterministic backoff", () => {
    const origin = Date.parse("2026-01-01T00:00:00.000Z");
    expect(retryAt(1, origin)).toBe("2026-01-01T00:00:01.000Z");
    expect(retryAt(2, origin)).toBe("2026-01-01T00:00:03.000Z");
    expect(retryAt(99, origin)).toBe("2026-01-01T00:01:00.000Z");
  });
});
