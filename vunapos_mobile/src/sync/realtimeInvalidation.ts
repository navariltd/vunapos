/** Application data that can be refreshed after a Frappe realtime signal. */
export const REALTIME_RESOURCES = ["workspace-configuration"] as const;

export type RealtimeResource = (typeof REALTIME_RESOURCES)[number];

type RefreshHandler = () => void | Promise<void>;

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

export function invalidateRealtimeResource(resource: RealtimeResource) {
  for (const handler of handlers.get(resource) ?? []) {
    void Promise.resolve(handler()).catch(() => {
      // A realtime notification is an acceleration path. A failed refresh is
      // surfaced by the resource that owns the request, never as an unhandled
      // rejection from the shared socket client.
    });
  }
}
