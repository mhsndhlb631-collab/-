import { randomUUID } from "node:crypto";
import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { MinhajOfflineDatabase } from "../../src/offline/database";
import {
  OfflineRepository,
  scopeId,
  scopedRecordId,
} from "../../src/offline/repository";

const databases: MinhajOfflineDatabase[] = [];

function database(name = `minhaj-test-${randomUUID()}`) {
  const db = new MinhajOfflineDatabase(name, { indexedDB, IDBKeyRange });
  databases.push(db);
  return db;
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    await db.delete();
  }
});

describe("OfflineRepository", () => {
  it("persists an optimistic record and its mutation atomically", async () => {
    const db = database();
    const repository = new OfflineRepository(db);
    const targetScope = scopeId("account-1", "workspace-1");

    const item = await repository.enqueue({
      id: "mutation-1",
      idempotencyKey: "stable-key-1",
      scopeId: targetScope,
      entityType: "attendance",
      entityId: "roster-1",
      operation: "UPDATE",
      command: "P2_SAVE_SESSION_RECORDS",
      method: "PUT",
      path: "/api/v1/sessions/session-1/records",
      payload: { status: "PRESENT" },
      optimisticData: { status: "PRESENT" },
      baseVersion: 2,
      dependencies: [],
    });

    expect(item.idempotencyKey).toBe("stable-key-1");
    expect(
      (await repository.pending(targetScope)).map((row) => row.id),
    ).toEqual(["mutation-1"]);
    expect(
      await db.records.get(
        scopedRecordId(targetScope, "attendance", "roster-1"),
      ),
    ).toMatchObject({
      syncStatus: "pending_update",
      baseVersion: 2,
      data: { status: "PRESENT" },
    });
  });

  it("keeps pending writes after closing and reopening the database", async () => {
    const name = `minhaj-test-${randomUUID()}`;
    const first = database(name);
    const firstRepository = new OfflineRepository(first);
    await firstRepository.enqueue({
      id: "persistent-mutation",
      scopeId: "scope-1",
      entityType: "followup",
      entityId: "local-followup-1",
      operation: "CREATE",
      command: "P5_CREATE_FOLLOWUP",
      method: "POST",
      path: "/api/v1/students/student-1/followups",
      payload: { outcome: "تمت المتابعة" },
      optimisticData: { outcome: "تمت المتابعة" },
      dependencies: [],
    });
    first.close();

    const reopened = database(name);
    const reopenedRepository = new OfflineRepository(reopened);
    expect(await reopenedRepository.pending("scope-1")).toHaveLength(1);
    expect((await reopenedRepository.pending("scope-1"))[0]).toMatchObject({
      id: "persistent-mutation",
      idempotencyKey: "persistent-mutation",
      status: "pending",
    });
  });

  it("recovers an interrupted syncing item without losing its key", async () => {
    const db = database();
    const repository = new OfflineRepository(db);
    const item = await repository.enqueue({
      id: "interrupted",
      idempotencyKey: "fixed-key",
      scopeId: "scope-1",
      entityType: "tracking",
      entityId: "entry-1",
      operation: "UPDATE",
      command: "P3_SAVE_TRACKING",
      method: "PUT",
      path: "/api/v1/tracking/entries",
      payload: { value: 3 },
      dependencies: [],
    });
    await repository.markSyncing(item);

    expect(await repository.recoverInterrupted("scope-1")).toBe(1);
    expect(await db.outbox.get("interrupted")).toMatchObject({
      status: "pending",
      idempotencyKey: "fixed-key",
      attempts: 1,
    });
  });

  it("never purges pending, failed, or conflict mutations", async () => {
    const db = database();
    const repository = new OfflineRepository(db);
    const pending = await repository.enqueue({
      id: "keep-pending",
      scopeId: "scope-1",
      entityType: "attendance",
      entityId: "r1",
      operation: "UPDATE",
      command: "SAVE",
      method: "PUT",
      path: "/save",
      payload: {},
      dependencies: [],
    });
    const completed = await repository.enqueue({
      id: "remove-synced",
      scopeId: "scope-1",
      entityType: "attendance",
      entityId: "r2",
      operation: "UPDATE",
      command: "SAVE",
      method: "PUT",
      path: "/save",
      payload: {},
      dependencies: [],
    });
    await repository.acknowledge(completed, { id: "r2" }, "request-1");
    await db.outbox.update(completed.id, {
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    expect(
      await repository.purgeSyncedBefore("scope-1", "2021-01-01T00:00:00.000Z"),
    ).toBe(1);
    expect(await db.outbox.get(completed.id)).toBeUndefined();
    expect(await db.outbox.get(pending.id)).toBeDefined();
  });

  it("preserves pending writes during an additive IndexedDB upgrade", async () => {
    const name = `minhaj-upgrade-${randomUUID()}`;
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(1).stores({
      scopes: "id, accountId, workspaceId, accessState, lastValidatedAt",
      snapshots: "id, scopeId, resource, fetchedAt, [scopeId+resource]",
      records:
        "id, scopeId, entityType, localId, serverId, syncStatus, updatedAt, [scopeId+entityType]",
      outbox:
        "id, scopeId, entityType, entityId, status, createdAt, nextAttemptAt, [scopeId+status]",
      idMap: "id, scopeId, localId, serverId, entityType",
      meta: "key, updatedAt",
    });
    await legacy.table("outbox").put({
      id: "write-before-upgrade",
      scopeId: "scope-1",
      entityType: "attendance",
      entityId: "roster-1",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      nextAttemptAt: null,
    });
    legacy.close();

    const upgraded = database(name);
    await upgraded.open();

    expect(await upgraded.outbox.get("write-before-upgrade")).toBeDefined();
    expect(upgraded.tables.map((table) => table.name)).toContain("conflicts");
  });
});
