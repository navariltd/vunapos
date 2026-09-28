import {
  getServerReachabilityDiagnostics,
  recordServerReachability,
  resetServerReachability,
  SERVER_REACHABILITY_FAILURE_THRESHOLD,
} from "@/sync/serverReachability";

describe("server reachability diagnostics", () => {
  beforeEach(() => resetServerReachability());

  it("does not report a transient failure as an outage", () => {
    recordServerReachability({ status: "unreachable", error: "timeout" });

    expect(getServerReachabilityDiagnostics()).toEqual(
      expect.objectContaining({
        consecutiveFailures: 1,
        status: "unknown",
        lastError: "timeout",
      }),
    );
  });

  it("reports an outage only after the bounded failure threshold", () => {
    for (let index = 0; index < SERVER_REACHABILITY_FAILURE_THRESHOLD; index += 1) {
      recordServerReachability({ status: "unreachable" });
    }

    expect(getServerReachabilityDiagnostics().status).toBe("unreachable");
  });

  it("keeps session expiry distinct from server unavailability", () => {
    recordServerReachability({ status: "session-expired", error: "expired" });

    expect(getServerReachabilityDiagnostics()).toEqual(
      expect.objectContaining({
        consecutiveFailures: 0,
        status: "session-expired",
        lastError: "expired",
      }),
    );
  });

  it("clears failures after a successful probe", () => {
    recordServerReachability({ status: "unreachable" });
    recordServerReachability({ status: "unreachable" });
    recordServerReachability({ status: "reachable" });

    expect(getServerReachabilityDiagnostics()).toEqual(
      expect.objectContaining({
        consecutiveFailures: 0,
        status: "reachable",
      }),
    );
  });
});
