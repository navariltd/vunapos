export type KitchenSocket = {
  emit: (event: string, ...args: string[]) => unknown;
  on: (event: string, listener: (data: unknown) => void) => unknown;
  off: (event: string, listener: (data: unknown) => void) => unknown;
};

// Shared station rooms survive when either the KDS or print worker unmounts.
const rooms = new WeakMap<KitchenSocket, Map<string, {count: number; subscribe: () => void}>>();
export function retainKitchenStation(socket: KitchenSocket, station: string) {
  let subscriptions = rooms.get(socket);
  if (!subscriptions) {subscriptions = new Map(); rooms.set(socket, subscriptions);}
  let room = subscriptions.get(station);
  if (!room) {
    const subscribe = () => {socket.emit("doc_subscribe", "Kitchen Station", station);};
    room = {count: 0, subscribe}; subscriptions.set(station, room);
    subscribe(); socket.on("connect", subscribe);
  }
  room.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--room.count === 0) {
      socket.emit("doc_unsubscribe", "Kitchen Station", station);
      socket.off("connect", room.subscribe); subscriptions.delete(station);
    }
  };
}

/** Own only this subscription's listeners, not every listener of an event type. */
export function subscribeKitchenStation(socket: KitchenSocket, station: string, refresh: () => Promise<void> | void) {
  const release = retainKitchenStation(socket, station);
  const update = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as { doctype?: string; name?: string; kitchen_station?: string };
    if ((event.doctype === "Kitchen Station" && event.name === station) || event.kitchen_station === station) void refresh();
  };

  socket.on("doc_update", update);
  socket.on("vunapos_kitchen_ticket_created", update);
  return () => {
    release();
    socket.off("doc_update", update);
    socket.off("vunapos_kitchen_ticket_created", update);
  };
}
