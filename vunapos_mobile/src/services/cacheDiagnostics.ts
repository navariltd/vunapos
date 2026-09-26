/**
 * Lightweight cache telemetry for development diagnostics and tests.
 *
 * Events intentionally contain no cache keys, namespaces, URLs, session IDs,
 * queries, customer identifiers, or payloads. This makes it safe to expose to
 * an in-app diagnostics view later without leaking business data.
 */
export type CacheDiagnostic = {
  durationMs?: number;
  operation: "clear" | "fetch" | "invalidate" | "read" | "write";
  outcome:
    | "deduplicated"
    | "error"
    | "hit"
    | "miss"
    | "skipped"
    | "stale"
    | "success";
  resource: string;
  rowsWritten?: number;
  source?: "memory" | "network" | "sqlite";
};

export type CacheDiagnosticSummary = {
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;
  averageFetchDurationMs: number;
  requestCount: number;
  rowsWritten: number;
};

const MAX_DIAGNOSTICS = 100;
const events: CacheDiagnostic[] = [];
const listeners = new Set<() => void>();

export function recordCacheDiagnostic(event: CacheDiagnostic) {
  events.push({ ...event });
  if (events.length > MAX_DIAGNOSTICS) events.splice(0, events.length - MAX_DIAGNOSTICS);
  for (const listener of listeners) listener();
}

export function getCacheDiagnostics(): CacheDiagnostic[] {
  return events.map((event) => ({ ...event }));
}

/** Produces aggregate performance counters without exposing cache contents. */
export function summarizeCacheDiagnostics(
  diagnostics = events,
): CacheDiagnosticSummary {
  const cacheHits = diagnostics.filter(
    (event) => event.operation === "read" && event.outcome === "hit",
  ).length;
  const cacheMisses = diagnostics.filter(
    (event) => event.operation === "read" && event.outcome === "miss",
  ).length;
  const fetches = diagnostics.filter(
    (event) =>
      event.operation === "fetch" &&
      event.outcome !== "deduplicated",
  );
  const durations = fetches.flatMap((event) =>
    typeof event.durationMs === "number" ? [event.durationMs] : [],
  );
  return {
    averageFetchDurationMs: durations.length
      ? durations.reduce((total, duration) => total + duration, 0) /
        durations.length
      : 0,
    cacheHitRate: cacheHits + cacheMisses
      ? cacheHits / (cacheHits + cacheMisses)
      : 0,
    cacheHits,
    cacheMisses,
    requestCount: fetches.length,
    rowsWritten: diagnostics.reduce(
      (total, event) => total + (event.rowsWritten ?? 0),
      0,
    ),
  };
}

export function clearCacheDiagnostics() {
  events.length = 0;
  for (const listener of listeners) listener();
}

export function subscribeCacheDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
