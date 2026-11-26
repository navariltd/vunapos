import { describe, expect, it, vi } from "vitest";
import {
  subscribeKitchenStation,
  subscribeWaiterReady,
} from "../kitchenRealtime";

describe("scoped kitchen realtime subscriptions", () => {
  it("filters stations and cleans up only its own callbacks", () => {
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const socket = {
      emit: vi.fn(),
      on: (event: string, listener: (value: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      off: (event: string, listener: (value: unknown) => void) => {
        listeners.get(event)?.delete(listener);
      },
    };
    const emit = (event: string, value: unknown) =>
      listeners.get(event)?.forEach((listener) => listener(value));
    const first = vi.fn();
    const second = vi.fn();
    const leaveFirst = subscribeKitchenStation(socket, "Kitchen", first);
    const leaveSecond = subscribeKitchenStation(socket, "Bar", second);
    emit("doc_update", { doctype: "Kitchen Station", name: "Kitchen" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    leaveFirst();
    emit("vunapos_kitchen_ticket_created", {
      name: "KOT-1",
      kitchen_station: "Bar",
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(listeners.get("doc_update")?.size).toBe(1);
    emit("connect", undefined);
    expect(socket.emit).toHaveBeenLastCalledWith(
      "doc_subscribe",
      "Kitchen Station",
      "Bar"
    );
    leaveSecond();
    expect(listeners.get("connect")?.size).toBe(0);
    expect(listeners.get("doc_update")?.size).toBe(0);
  });

  it("only announces well-formed new tickets for its own station, not reconnects or updates", () => {
    const listeners = new Map<string, (value: unknown) => void>();
    const socket = {
      emit: vi.fn(),
      on: (event: string, listener: (value: unknown) => void) =>
        listeners.set(event, listener),
      off: vi.fn(),
    };
    const refresh = vi.fn();
    const created = vi.fn();
    subscribeKitchenStation(socket, "Bar", refresh, created);
    const emit = (event: string, value?: unknown) =>
      listeners.get(event)?.(value);
    emit("connect");
    emit("doc_update", { doctype: "Kitchen Station", name: "Bar" });
    emit("vunapos_kitchen_ticket_created", {
      name: "KOT-1",
      kitchen_station: "Other",
    });
    emit("vunapos_kitchen_ticket_created", { kitchen_station: "Bar" });
    emit("vunapos_kitchen_ticket_created", null);
    expect(created).not.toHaveBeenCalled();
    emit("vunapos_kitchen_ticket_created", {
      name: "KOT-2",
      kitchen_station: "Bar",
    });
    expect(created).toHaveBeenCalledExactlyOnceWith("KOT-2");
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("waiter ready alerts", () => {
  const event = {
    event_id: "ACTION-1",
    waiter: "waiter@example.com",
    ticket: "KOT-1",
    session: "RS-1",
    sales_order: "SO-1",
    table_labels: "2",
    station_label: "Main Kitchen",
    ready_qty: 1,
  };

  it("only accepts the assigned waiter's events and deduplicates each action, not the ticket", () => {
    const listeners = new Map<string, (value: unknown) => void>();
    const socket = {
      emit: vi.fn(),
      on: (key: string, handler: (value: unknown) => void) =>
        listeners.set(key, handler),
      off: vi.fn(),
    };
    const notify = vi.fn();
    const leave = subscribeWaiterReady(socket, event.waiter, notify);
    const deliver = listeners.get("vunapos_kitchen_ready")!;
    deliver({ ...event, waiter: "someone-else@example.com" });
    deliver(null);
    deliver({ ...event, ready_qty: 0 });
    deliver({ ...event, ready_qty: NaN });
    deliver({ ...event, event_id: "" });
    expect(notify).not.toHaveBeenCalled();
    deliver(event);
    deliver(event);
    deliver({ ...event, event_id: "ACTION-2", ready_qty: 3 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith({
      ...event,
      event_id: "ACTION-2",
      ready_qty: 3,
    });
    leave();
    expect(socket.off).toHaveBeenCalledExactlyOnceWith(
      "vunapos_kitchen_ready",
      deliver
    );
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
