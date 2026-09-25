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
  source?: "memory" | "network" | "sqlite";
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

export function clearCacheDiagnostics() {
  events.length = 0;
  for (const listener of listeners) listener();
}

export function subscribeCacheDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
