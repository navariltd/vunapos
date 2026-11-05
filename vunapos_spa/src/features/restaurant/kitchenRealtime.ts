export type KitchenSocket = {
  emit: (event: string, ...args: string[]) => unknown;
  on: (event: string, listener: (data: unknown) => void) => unknown;
  off: (event: string, listener: (data: unknown) => void) => unknown;
};

/** Own only this subscription's listeners, not every listener of an event type. */
export function subscribeKitchenStation(socket: KitchenSocket, station: string, refresh: () => Promise<void> | void) {
  const subscribe = () => socket.emit("doc_subscribe", "Kitchen Station", station);
  const update = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as { doctype?: string; name?: string; kitchen_station?: string };
    if ((event.doctype === "Kitchen Station" && event.name === station) || event.kitchen_station === station) void refresh();
  };
  subscribe();
  socket.on("connect", subscribe);
  socket.on("doc_update", update);
  socket.on("vunapos_kitchen_ticket_created", update);
  return () => {
    socket.emit("doc_unsubscribe", "Kitchen Station", station);
    socket.off("connect", subscribe);
    socket.off("doc_update", update);
    socket.off("vunapos_kitchen_ticket_created", update);
  };
}
