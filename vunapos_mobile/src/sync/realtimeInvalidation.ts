import { POS_WORKSPACE_RESOURCE } from "@/sync/posResourceKeys";

/** Application data that can be refreshed after a Frappe realtime signal. */
export const REALTIME_RESOURCES = [
  POS_WORKSPACE_RESOURCE,
  "checkout-queue",
] as const;

/** Control signals are owned by the authenticated app root, never by screens. */
export const CONTROL_REALTIME_RESOURCES = [
  POS_WORKSPACE_RESOURCE,
] as const;

export type RealtimeResource = (typeof REALTIME_RESOURCES)[number];

type RefreshHandler = (payload?: unknown) => void | Promise<void>;

const handlers = new Map<RealtimeResource, Set<RefreshHandler>>();
const controlHandlers = new Map<RealtimeResource, Set<RefreshHandler>>();

function addHandler(
  registry: Map<RealtimeResource, Set<RefreshHandler>>,
  resource: RealtimeResource,
  handler: RefreshHandler,
) {
  const resourceHandlers = registry.get(resource) ?? new Set<RefreshHandler>();
  resourceHandlers.add(handler);
  registry.set(resource, resourceHandlers);

  return () => {
    resourceHandlers.delete(handler);
    if (!resourceHandlers.size) registry.delete(resource);
  };
}

/**
 * Registers a mounted resource to refresh itself. The realtime connection is
 * app-owned; individual features only declare which cached data they own.
 */
export function registerRealtimeRefresh(
  resource: RealtimeResource,
  handler: RefreshHandler,
) {
  return addHandler(handlers, resource, handler);
}

/** Registers an app-owned control handler that survives feature navigation. */
export function registerRealtimeControlRefresh(
  resource: (typeof CONTROL_REALTIME_RESOURCES)[number],
  handler: RefreshHandler,
) {
  return addHandler(controlHandlers, resource, handler);
}

export function invalidateRealtimeResource(
  resource: RealtimeResource,
  payload?: unknown,
) {
  const registry = CONTROL_REALTIME_RESOURCES.includes(
    resource as (typeof CONTROL_REALTIME_RESOURCES)[number],
  )
    ? controlHandlers
    : handlers;
  const refreshes = [...(registry.get(resource) ?? [])].map((handler) =>
    Promise.resolve(handler(payload)).catch(() => {
      // A realtime notification is an acceleration path. A failed refresh is
      // surfaced by the resource that owns the request, never as an unhandled
      // rejection from the shared socket client.
    }),
  );
  return Promise.all(refreshes).then(() => undefined);
}
