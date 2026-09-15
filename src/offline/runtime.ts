import { activeScopeId, connectivity, deviceRepository } from "./client";
import { httpSyncTransport, SyncManager } from "./sync-manager";

type RuntimeListener = () => void;

let manager: SyncManager | null = null;
const listeners = new Set<RuntimeListener>();
let startedScope: string | null = null;
let cleanup: (() => void) | null = null;
let retryTimer: number | null = null;

function notify() {
  for (const listener of listeners) listener();
}

async function withBrowserLock<T>(scope: string, work: () => Promise<T>) {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(
      `minhaj-sync:${scope}`,
      { ifAvailable: true },
      (lock) => (lock ? work() : Promise.resolve(null)),
    );
  return work();
}

async function scheduleNextRetry(scope: string) {
  if (typeof window === "undefined" || startedScope !== scope) return;
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
  const pending = await deviceRepository().pending(scope);
  if (!pending.length) return;
  const eligible = (
    await Promise.all(
      pending.map(async (item) => ({
        item,
        ready: (
          await Promise.all(
            item.dependencies.map((id) =>
              deviceRepository().dependencyIsSynced(id),
            ),
          )
        ).every(Boolean),
      })),
    )
  )
    .filter(({ ready }) => ready)
    .map(({ item }) => item);
  if (!eligible.length) return;
  const dueAt = Math.min(
    ...eligible.map((item) =>
      item.nextAttemptAt ? Date.parse(item.nextAttemptAt) : Date.now(),
    ),
  );
  const delay = Math.max(250, Math.min(dueAt - Date.now(), 60_000));
  retryTimer = window.setTimeout(() => void synchronizeNow(), delay);
}

export async function synchronizeNow(options: { force?: boolean } = {}) {
  const scope = activeScopeId();
  if (!scope) return { processed: 0, skipped: true };
  manager ??= new SyncManager(
    deviceRepository(),
    httpSyncTransport(fetch, (status) => connectivity.reportHttp(status)),
  );
  const result = await withBrowserLock(scope, () =>
    manager!.run(scope, options),
  );
  const repository = deviceRepository();
  const counts = await repository.counts(scope);
  if (connectivity.current().kind === "online" && counts.pending === 0)
    await repository.setMeta(`last-sync:${scope}`, new Date().toISOString());
  const retentionCutoff = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  await repository.purgeSyncedBefore(scope, retentionCutoff);
  notify();
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("minhaj:sync-finished"));
  await scheduleNextRetry(scope);
  return result ?? { processed: 0, skipped: true };
}

export function subscribeToSync(listener: RuntimeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startOfflineRuntime(scope: string) {
  if (startedScope === scope && cleanup) return cleanup;
  cleanup?.();
  startedScope = scope;
  connectivity.start();
  void deviceRepository()
    .resumeBlockedAuth(scope)
    .then(() => synchronizeNow());
  const onOnline = () => void synchronizeNow();
  const onVisible = () => {
    if (document.visibilityState === "visible") void synchronizeNow();
  };
  const onOutbox = () => void synchronizeNow();
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onOnline);
  window.addEventListener("minhaj:outbox-changed", onOutbox);
  document.addEventListener("visibilitychange", onVisible);
  const periodic = window.setInterval(() => void synchronizeNow(), 60_000);
  cleanup = () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onOnline);
    window.removeEventListener("minhaj:outbox-changed", onOutbox);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(periodic);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    connectivity.stop();
    startedScope = null;
    cleanup = null;
  };
  return cleanup;
}
