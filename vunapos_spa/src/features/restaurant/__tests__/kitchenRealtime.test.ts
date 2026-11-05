import { describe, expect, it, vi } from "vitest";
import { subscribeKitchenStation } from "../kitchenRealtime";

describe("scoped kitchen realtime subscriptions", () => {
  it("filters stations and cleans up only its own callbacks", () => {
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const socket = {
      emit: vi.fn(),
      on: (event: string, listener: (value: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      off: (event: string, listener: (value: unknown) => void) => { listeners.get(event)?.delete(listener); },
    };
    const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((listener) => listener(value));
    const first = vi.fn();
    const second = vi.fn();
    const leaveFirst = subscribeKitchenStation(socket, "Kitchen", first);
    const leaveSecond = subscribeKitchenStation(socket, "Bar", second);
    emit("doc_update", { doctype: "Kitchen Station", name: "Kitchen" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    leaveFirst();
    emit("vunapos_kitchen_ticket_created", { kitchen_station: "Bar" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(listeners.get("doc_update")?.size).toBe(1);
    emit("connect", undefined);
    expect(socket.emit).toHaveBeenLastCalledWith("doc_subscribe", "Kitchen Station", "Bar");
    leaveSecond();
    expect(listeners.get("connect")?.size).toBe(0);
    expect(listeners.get("doc_update")?.size).toBe(0);
  });
});
