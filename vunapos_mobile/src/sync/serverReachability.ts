export type ServerReachabilityStatus =
  | "unknown"
  | "reachable"
  | "unreachable"
  | "session-expired";

export type ServerReachabilityDiagnostics = {
  consecutiveFailures: number;
  lastCheckedAt?: string;
  lastError?: string;
  status: ServerReachabilityStatus;
};

const REQUIRED_FAILURES = 2;
let diagnostics: ServerReachabilityDiagnostics = {
  consecutiveFailures: 0,
  status: "unknown",
};
const listeners = new Set<() => void>();

function publish(next: ServerReachabilityDiagnostics) {
  diagnostics = next;
  for (const listener of listeners) listener();
}

export function getServerReachabilityDiagnostics() {
  return diagnostics;
}

export function subscribeServerReachability(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetServerReachability() {
  publish({ consecutiveFailures: 0, status: "unknown" });
}

export function recordServerReachability(
  result:
    | { status: "reachable" }
    | { status: "session-expired"; error?: string }
    | { status: "unreachable"; error?: string },
) {
  const checkedAt = new Date().toISOString();
  if (result.status === "reachable") {
    publish({
      consecutiveFailures: 0,
      lastCheckedAt: checkedAt,
      status: "reachable",
    });
    return;
  }

  if (result.status === "session-expired") {
    publish({
      consecutiveFailures: 0,
      lastCheckedAt: checkedAt,
      lastError: result.error,
      status: "session-expired",
    });
    return;
  }

  const consecutiveFailures = diagnostics.consecutiveFailures + 1;
  publish({
    consecutiveFailures,
    lastCheckedAt: checkedAt,
    lastError: result.error,
    status:
      consecutiveFailures >= REQUIRED_FAILURES ? "unreachable" : diagnostics.status,
  });
}

export const SERVER_REACHABILITY_FAILURE_THRESHOLD = REQUIRED_FAILURES;
