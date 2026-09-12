import { describe, expect, it } from "vitest";
import { ConnectivityMonitor } from "../../src/offline/connectivity";

describe("ConnectivityMonitor", () => {
  it("does not classify a server failure or 401 as no internet", () => {
    const monitor = new ConnectivityMonitor(true);
    monitor.reportHttp(500);
    expect(monitor.current().kind).toBe("server_error");
    monitor.reportHttp(401);
    expect(monitor.current().kind).toBe("auth_required");
  });

  it("treats navigator status as a hint and request failures as degraded", () => {
    const monitor = new ConnectivityMonitor(true);
    expect(monitor.current().kind).toBe("degraded");
    monitor.reportNetworkFailure();
    expect(monitor.current().kind).toBe("degraded");
    monitor.reportBrowserHint(false);
    expect(monitor.current().kind).toBe("offline");
    monitor.reportBrowserHint(true);
    expect(monitor.current().kind).toBe("degraded");
    monitor.reportHttp(200);
    expect(monitor.current().kind).toBe("online");
  });
});
