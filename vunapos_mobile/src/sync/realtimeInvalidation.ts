/** Application data that can be refreshed after a Frappe realtime signal. */
export const REALTIME_RESOURCES = [
  "workspace-configuration",
  "checkout-queue",
] as const;

export type RealtimeResource = (typeof REALTIME_RESOURCES)[number];

type RefreshHandler = (payload?: unknown) => void | Promise<void>;

const handlers = new Map<RealtimeResource, Set<RefreshHandler>>();

/**
 * Registers a mounted resource to refresh itself. The realtime connection is
 * app-owned; individual features only declare which cached data they own.
 */
export function registerRealtimeRefresh(
  resource: RealtimeResource,
  handler: RefreshHandler,
) {
  const resourceHandlers = handlers.get(resource) ?? new Set<RefreshHandler>();
  resourceHandlers.add(handler);
  handlers.set(resource, resourceHandlers);

  return () => {
    resourceHandlers.delete(handler);
    if (!resourceHandlers.size) handlers.delete(resource);
  };
}

export function invalidateRealtimeResource(
  resource: RealtimeResource,
  payload?: unknown,
) {
  const refreshes = [...(handlers.get(resource) ?? [])].map((handler) =>
    Promise.resolve(handler(payload)).catch(() => {
      // A realtime notification is an acceleration path. A failed refresh is
      // surfaced by the resource that owns the request, never as an unhandled
      // rejection from the shared socket client.
    }),
  );
  return Promise.all(refreshes).then(() => undefined);
}
