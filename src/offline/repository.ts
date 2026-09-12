import type { MinhajOfflineDatabase } from "./database";
import type {
  OfflineRecord,
  OfflineScope,
  OfflineSnapshot,
  OutboxItem,
  QueuedMutation,
  SafeSyncError,
  SyncStatus,
} from "./types";

export function scopeId(accountId: string, workspaceId: string) {
  return `${accountId}:${workspaceId}`;
}

export function scopedRecordId(
  targetScopeId: string,
  entityType: string,
  localId: string,
) {
  return `${targetScopeId}:${entityType}:${localId}`;
}

export function scopedSnapshotId(targetScopeId: string, resource: string) {
  return `${targetScopeId}:${resource}`;
}

function now() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function recordSyncStatus(operation: QueuedMutation["operation"]): SyncStatus {
  if (operation === "CREATE") return "pending_create";
  if (operation === "DELETE") return "pending_delete";
  return "pending_update";
}

export class OfflineRepository {
  constructor(private readonly db: MinhajOfflineDatabase) {}

  async saveScope(scope: OfflineScope) {
    await this.db.scopes.put(scope);
  }

  latestActiveScope() {
    return this.db.scopes
      .where("accessState")
      .equals("active")
      .toArray()
      .then(
        (rows) =>
          rows.sort((left, right) =>
            right.lastValidatedAt.localeCompare(left.lastValidatedAt),
          )[0] ?? null,
      );
  }

  async revokeScope(targetScopeId: string) {
    await this.db.scopes.update(targetScopeId, {
      accessState: "revoked",
      lastValidatedAt: now(),
    });
  }

  async cacheSnapshot(
    targetScopeId: string,
    resource: string,
    payload: unknown,
    serverCursor: string | null = null,
  ) {
    const snapshot: OfflineSnapshot = {
      id: scopedSnapshotId(targetScopeId, resource),
      scopeId: targetScopeId,
      resource,
      payload,
      serverCursor,
      fetchedAt: now(),
    };
    await this.db.snapshots.put(snapshot);
    return snapshot;
  }

  async snapshot<T>(targetScopeId: string, resource: string) {
    const row = await this.db.snapshots.get(
      scopedSnapshotId(targetScopeId, resource),
    );
    return (row as (OfflineSnapshot & { payload: T }) | undefined) ?? null;
  }

  async enqueue(input: QueuedMutation) {
    const timestamp = now();
    const mutationId = input.id ?? uuid();
    const idempotencyKey = input.idempotencyKey ?? mutationId;
    const recordId = scopedRecordId(
      input.scopeId,
      input.entityType,
      input.entityId,
    );
    const outbox: OutboxItem = {
      id: mutationId,
      scopeId: input.scopeId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      command: input.command,
      method: input.method,
      path: input.path,
      payload: input.payload,
      idempotencyKey,
      dependencies: input.dependencies,
      status: "pending",
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAttemptAt: null,
      nextAttemptAt: null,
      error: null,
      requestId: null,
    };

    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.outbox,
      async () => {
        const current = await this.db.records.get(recordId);
        const record: OfflineRecord = {
          id: recordId,
          scopeId: input.scopeId,
          entityType: input.entityType,
          localId: input.entityId,
          serverId: current?.serverId ?? null,
          data: input.optimisticData ?? current?.data ?? input.payload,
          syncStatus: recordSyncStatus(input.operation),
          baseVersion: input.baseVersion ?? current?.baseVersion ?? null,
          deviceMutationId: mutationId,
          createdAt: current?.createdAt ?? timestamp,
          updatedAt: timestamp,
          lastSyncedAt: current?.lastSyncedAt ?? null,
          deletedAt: input.operation === "DELETE" ? timestamp : null,
        };
        await this.db.records.put(record);
        await this.db.outbox.add(outbox);
      },
    );
    return outbox;
  }

  pending(targetScopeId: string) {
    return this.db.outbox
      .where("scopeId")
      .equals(targetScopeId)
      .filter((item) => item.status === "pending")
      .sortBy("createdAt");
  }

  async recoverInterrupted(targetScopeId: string) {
    const interrupted = await this.db.outbox
      .where("scopeId")
      .equals(targetScopeId)
      .filter((item) => item.status === "syncing")
      .toArray();
    await this.db.transaction("rw", this.db.outbox, async () => {
      for (const item of interrupted)
        await this.db.outbox.update(item.id, {
          status: "pending",
          updatedAt: now(),
        });
    });
    return interrupted.length;
  }

  async markSyncing(item: OutboxItem) {
    const timestamp = now();
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.records,
      async () => {
        await this.db.outbox.update(item.id, {
          status: "syncing",
          attempts: item.attempts + 1,
          lastAttemptAt: timestamp,
          updatedAt: timestamp,
          error: null,
        });
        await this.db.records.update(
          scopedRecordId(item.scopeId, item.entityType, item.entityId),
          { syncStatus: "syncing", updatedAt: timestamp },
        );
      },
    );
  }

  async acknowledge(
    item: OutboxItem,
    result: Record<string, unknown> | null,
    requestId: string | null,
  ) {
    const timestamp = now();
    const serverId = typeof result?.id === "string" ? result.id : null;
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.records,
      this.db.idMap,
      async () => {
        await this.db.outbox.update(item.id, {
          status: "synced",
          updatedAt: timestamp,
          nextAttemptAt: null,
          requestId,
          error: null,
        });
        const target = scopedRecordId(
          item.scopeId,
          item.entityType,
          item.entityId,
        );
        await this.db.records.update(target, {
          syncStatus: "synced",
          serverId,
          deviceMutationId: null,
          lastSyncedAt: timestamp,
          updatedAt: timestamp,
        });
        if (serverId && serverId !== item.entityId)
          await this.db.idMap.put({
            id: `${item.scopeId}:${item.entityId}`,
            scopeId: item.scopeId,
            localId: item.entityId,
            serverId,
            entityType: item.entityType,
            createdAt: timestamp,
          });
      },
    );
  }

  async defer(item: OutboxItem, nextAttemptAt: string, error: SafeSyncError) {
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.records,
      async () => {
        await this.db.outbox.update(item.id, {
          status: "pending",
          updatedAt: now(),
          nextAttemptAt,
          error,
          requestId: error.requestId,
        });
        await this.db.records.update(
          scopedRecordId(item.scopeId, item.entityType, item.entityId),
          { syncStatus: recordSyncStatus(item.operation), updatedAt: now() },
        );
      },
    );
  }

  async fail(
    item: OutboxItem,
    status: Exclude<OutboxItem["status"], "pending" | "syncing" | "synced">,
    error: SafeSyncError,
  ) {
    const recordStatus = status === "conflict" ? "conflict" : "failed";
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.records,
      this.db.conflicts,
      async () => {
        await this.db.outbox.update(item.id, {
          status,
          error,
          requestId: error.requestId,
          nextAttemptAt: null,
          updatedAt: now(),
        });
        await this.db.records.update(
          scopedRecordId(item.scopeId, item.entityType, item.entityId),
          { syncStatus: recordStatus, updatedAt: now() },
        );
        if (status === "conflict") {
          const record = await this.db.records.get(
            scopedRecordId(item.scopeId, item.entityType, item.entityId),
          );
          await this.db.conflicts.put({
            id: item.id,
            scopeId: item.scopeId,
            outboxId: item.id,
            entityType: item.entityType,
            entityId: item.entityId,
            baseVersion: record?.baseVersion ?? null,
            localValue: record?.data ?? item.payload,
            serverValue: null,
            createdAt: now(),
            resolvedAt: null,
          });
        }
      },
    );
  }

  async dependencyIsSynced(id: string) {
    return (await this.db.outbox.get(id))?.status === "synced";
  }

  async resolveServerId(targetScopeId: string, localId: string) {
    return (
      (await this.db.idMap.get(`${targetScopeId}:${localId}`))?.serverId ?? null
    );
  }

  async counts(targetScopeId: string) {
    const rows = await this.db.outbox
      .where("scopeId")
      .equals(targetScopeId)
      .toArray();
    return {
      pending: rows.filter((item) =>
        ["pending", "syncing"].includes(item.status),
      ).length,
      failed: rows.filter((item) =>
        [
          "failed_validation",
          "failed_permission",
          "failed_missing_dependency",
          "blocked_auth",
        ].includes(item.status),
      ).length,
      conflicts: rows.filter((item) => item.status === "conflict").length,
    };
  }

  async purgeSyncedBefore(targetScopeId: string, cutoff: string) {
    const completed = await this.db.outbox
      .where("scopeId")
      .equals(targetScopeId)
      .filter((item) => item.status === "synced" && item.updatedAt < cutoff)
      .primaryKeys();
    await this.db.outbox.bulkDelete(completed);
    return completed.length;
  }
}
