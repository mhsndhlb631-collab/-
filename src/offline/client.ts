import { ConnectivityMonitor } from "./connectivity";
import { closeOfflineDatabase, offlineDatabase } from "./database";
import { OfflineRepository, scopeId } from "./repository";
import type { ActorRole, OfflineScope } from "./types";

export type CachedSource = "server" | "device";

export class OfflineReadError extends Error {
  constructor(
    readonly code: "UNAUTHORIZED" | "SERVER" | "NETWORK" | "NO_CACHE",
    readonly status: number | null,
  ) {
    super(code);
    this.name = "OfflineReadError";
  }
}

type Identity = {
  account_id: string;
  workspace_id: string;
  display_name: string;
  workspace_name: string;
  role: ActorRole;
};

let currentScopeId: string | null = null;
let repositorySingleton: OfflineRepository | null = null;

export const connectivity = new ConnectivityMonitor(
  typeof navigator === "undefined" ? true : navigator.onLine,
);

export function deviceRepository() {
  repositorySingleton ??= new OfflineRepository(offlineDatabase());
  return repositorySingleton;
}

export function activeScopeId() {
  return currentScopeId;
}

export function setOfflineScope(targetScopeId: string | null) {
  currentScopeId = targetScopeId;
}

export function resetOfflineClient() {
  currentScopeId = null;
  repositorySingleton = null;
  closeOfflineDatabase();
}

function resourceKey(path: string) {
  const url = new URL(path, "https://minhaj.local");
  return `${url.pathname}${url.search}`;
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException;
}

export async function readJson<T>(
  path: string,
  options: { scope?: string | null; signal?: AbortSignal } = {},
): Promise<{ data: T; source: CachedSource }> {
  const targetScope = options.scope ?? currentScopeId;
  try {
    const response = await fetch(path, {
      cache: "no-store",
      signal: options.signal,
    });
    connectivity.reportHttp(response.status);
    if (response.status === 401)
      throw new OfflineReadError("UNAUTHORIZED", 401);
    if (!response.ok) throw new OfflineReadError("SERVER", response.status);
    const data = (await response.json()) as T;
    if (targetScope && resourceKey(path) !== "/api/v1/me")
      await deviceRepository().cacheSnapshot(
        targetScope,
        resourceKey(path),
        data,
      );
    return { data, source: "server" };
  } catch (error) {
    if (error instanceof OfflineReadError) {
      if (error.code === "UNAUTHORIZED") throw error;
    } else if (isNetworkError(error)) {
      connectivity.reportNetworkFailure();
    } else {
      throw error;
    }
    if (targetScope) {
      const cached = await deviceRepository().snapshot<T>(
        targetScope,
        resourceKey(path),
      );
      if (cached) return { data: cached.payload, source: "device" };
    }
    if (error instanceof OfflineReadError) throw error;
    throw new OfflineReadError("NO_CACHE", null);
  }
}

export async function saveAuthenticatedIdentity(identity: Identity) {
  const targetScope = scopeId(identity.account_id, identity.workspace_id);
  const timestamp = new Date().toISOString();
  const scope: OfflineScope = {
    id: targetScope,
    accountId: identity.account_id,
    workspaceId: identity.workspace_id,
    displayName: identity.display_name,
    workspaceName: identity.workspace_name,
    role: identity.role,
    accessState: "active",
    lastAuthenticatedAt: timestamp,
    lastValidatedAt: timestamp,
  };
  await deviceRepository().saveScope(scope);
  setOfflineScope(targetScope);
  await deviceRepository().cacheSnapshot(targetScope, "/api/v1/me", identity);
  return scope;
}

export async function restoreAuthenticatedIdentity<T extends Identity>() {
  const scope = await deviceRepository().latestActiveScope();
  if (!scope) return null;
  const cached = await deviceRepository().snapshot<T>(scope.id, "/api/v1/me");
  if (!cached) return null;
  setOfflineScope(scope.id);
  return { scope, identity: cached.payload };
}

export async function cacheJson(
  targetScope: string,
  path: string,
  payload: unknown,
) {
  return deviceRepository().cacheSnapshot(
    targetScope,
    resourceKey(path),
    payload,
  );
}
