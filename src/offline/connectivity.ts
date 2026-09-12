import type { ConnectivityKind } from "./types";

export type ConnectivityState = {
  kind: ConnectivityKind;
  browserOnline: boolean;
  lastCheckedAt: string | null;
};

export class ConnectivityMonitor {
  private state: ConnectivityState;
  private readonly listeners = new Set<(state: ConnectivityState) => void>();
  private stopBrowserListeners: (() => void) | null = null;

  constructor(browserOnline = true) {
    this.state = {
      kind: browserOnline ? "degraded" : "offline",
      browserOnline,
      lastCheckedAt: null,
    };
  }

  current() {
    return this.state;
  }

  subscribe(listener: (state: ConnectivityState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (typeof window === "undefined" || this.stopBrowserListeners) return;
    const update = () => this.reportBrowserHint(window.navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    this.stopBrowserListeners = () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      this.stopBrowserListeners = null;
    };
    update();
  }

  stop() {
    this.stopBrowserListeners?.();
  }

  reportBrowserHint(online: boolean) {
    this.publish({
      browserOnline: online,
      kind: online
        ? this.state.kind === "offline"
          ? "degraded"
          : this.state.kind
        : "offline",
      lastCheckedAt: this.state.lastCheckedAt,
    });
  }

  reportHttp(status: number) {
    const kind: ConnectivityKind =
      status === 401
        ? "auth_required"
        : status >= 500
          ? "server_error"
          : "online";
    this.publish({
      browserOnline: true,
      kind,
      lastCheckedAt: new Date().toISOString(),
    });
  }

  reportNetworkFailure() {
    this.publish({
      browserOnline: this.state.browserOnline,
      kind: this.state.browserOnline ? "degraded" : "offline",
      lastCheckedAt: new Date().toISOString(),
    });
  }

  private publish(next: ConnectivityState) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
