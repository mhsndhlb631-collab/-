import Dexie, { type DexieOptions, type EntityTable } from "dexie";
import type {
  IdMapping,
  OfflineConflict,
  OfflineMeta,
  OfflineRecord,
  OfflineScope,
  OfflineSnapshot,
  OutboxItem,
} from "./types";

export class MinhajOfflineDatabase extends Dexie {
  scopes!: EntityTable<OfflineScope, "id">;
  snapshots!: EntityTable<OfflineSnapshot, "id">;
  records!: EntityTable<OfflineRecord, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  idMap!: EntityTable<IdMapping, "id">;
  meta!: EntityTable<OfflineMeta, "key">;
  conflicts!: EntityTable<OfflineConflict, "id">;

  constructor(name = "minhaj-offline", options?: DexieOptions) {
    super(name, options);

    this.version(1).stores({
      scopes: "id, accountId, workspaceId, accessState, lastValidatedAt",
      snapshots: "id, scopeId, resource, fetchedAt, [scopeId+resource]",
      records:
        "id, scopeId, entityType, localId, serverId, syncStatus, updatedAt, [scopeId+entityType]",
      outbox:
        "id, scopeId, entityType, entityId, status, createdAt, nextAttemptAt, [scopeId+status]",
      idMap: "id, scopeId, localId, serverId, entityType",
      meta: "key, updatedAt",
    });

    // Additive upgrades must never rebuild or clear the outbox.
    this.version(2).stores({
      scopes: "id, accountId, workspaceId, accessState, lastValidatedAt",
      snapshots: "id, scopeId, resource, fetchedAt, [scopeId+resource]",
      records:
        "id, scopeId, entityType, localId, serverId, syncStatus, updatedAt, [scopeId+entityType]",
      outbox:
        "id, scopeId, entityType, entityId, status, createdAt, nextAttemptAt, [scopeId+status]",
      idMap: "id, scopeId, localId, serverId, entityType",
      meta: "key, updatedAt",
      conflicts: "id, scopeId, outboxId, entityType, entityId, resolvedAt",
    });

    this.on("versionchange", () => this.close());
  }
}

let browserDatabase: MinhajOfflineDatabase | null = null;

export function offlineDatabase() {
  if (typeof indexedDB === "undefined")
    throw new Error("OFFLINE_STORAGE_UNAVAILABLE");
  browserDatabase ??= new MinhajOfflineDatabase();
  return browserDatabase;
}

export function closeOfflineDatabase() {
  browserDatabase?.close();
  browserDatabase = null;
}
