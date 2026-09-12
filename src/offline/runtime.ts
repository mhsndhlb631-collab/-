import { activeScopeId, connectivity, deviceRepository } from "./client";
import { httpSyncTransport, SyncManager } from "./sync-manager";

type RuntimeListener = () => void;

let manager: SyncManager | null = null;
const listeners = new Set<RuntimeListener>();
let startedScope: string | null = null;
let cleanup: (() => void) | null = null;

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

export async function synchronizeNow() {
  const scope = activeScopeId();
  if (!scope) return { processed: 0, skipped: true };
  manager ??= new SyncManager(deviceRepository(), httpSyncTransport());
  const result = await withBrowserLock(scope, () => manager!.run(scope));
  notify();
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("minhaj:sync-finished"));
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
    connectivity.stop();
    startedScope = null;
    cleanup = null;
  };
  return cleanup;
}
