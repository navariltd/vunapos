export type KitchenSocket = {
  emit: (event: string, ...args: string[]) => unknown;
  on: (event: string, listener: (data: unknown) => void) => unknown;
  off: (event: string, listener: (data: unknown) => void) => unknown;
};

export type KitchenReadyEvent = {
  event_id: string;
  waiter: string;
  ticket: string;
  session: string;
  sales_order: string;
  table_labels: string;
  station_label: string;
  ready_qty: number;
};

/** The server delivers this through the authenticated user's private room. */
export function subscribeWaiterReady(
  socket: KitchenSocket,
  user: string,
  onReady: (event: KitchenReadyEvent) => void
) {
  const seen = new Set<string>();
  const ready = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as KitchenReadyEvent;
    if (
      event.waiter !== user ||
      ![event.event_id, event.ticket, event.session, event.sales_order].every(
        (field) => typeof field === "string" && field.length > 0
      ) ||
      typeof event.table_labels !== "string" ||
      typeof event.station_label !== "string" ||
      !Number.isFinite(event.ready_qty) ||
      event.ready_qty <= 0 ||
      seen.has(event.event_id)
    )
      return;
    seen.add(event.event_id);
    if (seen.size > 5000) seen.delete(seen.values().next().value!);
    onReady(event);
  };
  socket.on("vunapos_kitchen_ready", ready);
  return () => {
    socket.off("vunapos_kitchen_ready", ready);
  };
}

/** Own only this subscription's listeners, not every listener of an event type. */
export function subscribeKitchenStation(
  socket: KitchenSocket,
  station: string,
  refresh: () => Promise<void> | void,
  onCreated?: (name: string) => void
) {
  const subscribe = () =>
    socket.emit("doc_subscribe", "Kitchen Station", station);
  const update = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as {
      doctype?: string;
      name?: string;
      kitchen_station?: string;
    };
    if (
      (event.doctype === "Kitchen Station" && event.name === station) ||
      event.kitchen_station === station
    )
      void refresh();
  };
  const created = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as { name?: unknown; kitchen_station?: unknown };
    if (
      event.kitchen_station !== station ||
      typeof event.name !== "string" ||
      !event.name
    )
      return;
    onCreated?.(event.name);
    void refresh();
  };
  subscribe();
  socket.on("connect", subscribe);
  socket.on("doc_update", update);
  socket.on("vunapos_kitchen_ticket_created", created);
  return () => {
    socket.emit("doc_unsubscribe", "Kitchen Station", station);
    socket.off("connect", subscribe);
    socket.off("doc_update", update);
    socket.off("vunapos_kitchen_ticket_created", created);
  };
}
