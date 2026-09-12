export type ActorRole = "RESPONSIBLE" | "MENTOR" | "STUDENT";

export type SyncStatus =
  | "synced"
  | "pending_create"
  | "pending_update"
  | "pending_delete"
  | "syncing"
  | "failed"
  | "conflict";

export type OutboxStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed_validation"
  | "failed_permission"
  | "failed_missing_dependency"
  | "blocked_auth"
  | "conflict";

export type ConnectivityKind =
  "online" | "offline" | "degraded" | "server_error" | "auth_required";

export type OfflineScope = {
  id: string;
  accountId: string;
  workspaceId: string;
  displayName: string;
  workspaceName: string;
  role: ActorRole;
  accessState: "active" | "revoked";
  lastAuthenticatedAt: string;
  lastValidatedAt: string;
};

export type OfflineSnapshot = {
  id: string;
  scopeId: string;
  resource: string;
  payload: unknown;
  serverCursor: string | null;
  fetchedAt: string;
};

export type OfflineRecord = {
  id: string;
  scopeId: string;
  entityType: string;
  localId: string;
  serverId: string | null;
  data: unknown;
  syncStatus: SyncStatus;
  baseVersion: number | null;
  deviceMutationId: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  deletedAt: string | null;
};

export type OfflineOperation = "CREATE" | "UPDATE" | "DELETE" | "COMMAND";

export type SafeSyncError = {
  code: string;
  message: string;
  httpStatus: number | null;
  requestId: string | null;
};

export type OutboxItem = {
  id: string;
  scopeId: string;
  entityType: string;
  entityId: string;
  operation: OfflineOperation;
  command: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  payload: unknown;
  idempotencyKey: string;
  dependencies: string[];
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  error: SafeSyncError | null;
  requestId: string | null;
};

export type IdMapping = {
  id: string;
  scopeId: string;
  localId: string;
  serverId: string;
  entityType: string;
  createdAt: string;
};

export type OfflineMeta = {
  key: string;
  value: unknown;
  updatedAt: string;
};

export type OfflineConflict = {
  id: string;
  scopeId: string;
  outboxId: string;
  entityType: string;
  entityId: string;
  baseVersion: number | null;
  localValue: unknown;
  serverValue: unknown | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type QueuedMutation = Pick<
  OutboxItem,
  | "scopeId"
  | "entityType"
  | "entityId"
  | "operation"
  | "command"
  | "method"
  | "path"
  | "payload"
  | "dependencies"
> & {
  id?: string;
  idempotencyKey?: string;
  baseVersion?: number | null;
  optimisticData?: unknown;
};

export type SyncAcknowledgement = {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
  requestId: string | null;
};
