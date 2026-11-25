import { describe, expect, it, vi } from "vitest";
import { subscribeKitchenStation } from "../kitchenRealtime";
import { createPoller } from "../poller";

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

it("keeps a shared station subscribed until its final consumer leaves", () => {
  const socket = {emit: vi.fn(), on: vi.fn(), off: vi.fn()};
  const first = subscribeKitchenStation(socket, "Kitchen", vi.fn());
  const second = subscribeKitchenStation(socket, "Kitchen", vi.fn());
  expect(socket.emit).toHaveBeenCalledTimes(1);
  first();
  expect(socket.emit).toHaveBeenCalledTimes(1);
  second();
  expect(socket.emit).toHaveBeenLastCalledWith("doc_unsubscribe", "Kitchen Station", "Kitchen");
});

it("refreshes after cancellation during an in-flight board request without overlap", async () => {
  vi.useFakeTimers();
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
  let release: () => void = () => {};
  const fetchBoard = vi.fn(async () => {});
  fetchBoard.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const poller = createPoller({ intervalMs: 12_000, task: fetchBoard, isVisible: () => true, onVisibilityChange: () => () => {} });
  const leave = subscribeKitchenStation(socket, "Kitchen", poller.refresh);
  try {
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    emit("vunapos_kitchen_action_saved", { name: "ACTION-1", kitchen_station: "Bar", action: "Cancel" });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBoard).toHaveBeenCalledTimes(1);

    fetchBoard.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const request = poller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    emit("vunapos_kitchen_action_saved", { name: "ACTION-2", kitchen_station: "Kitchen", action: "Cancel" });
    emit("vunapos_kitchen_action_saved", { name: "ACTION-3", kitchen_station: "Kitchen", action: "Cancel" });
    expect(fetchBoard).toHaveBeenCalledTimes(2);
    release();
    await request;
    expect(fetchBoard).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(fetchBoard).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchBoard).toHaveBeenCalledTimes(4);
    leave();
    emit("vunapos_kitchen_action_saved", { kitchen_station: "Kitchen", action: "Cancel" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBoard).toHaveBeenCalledTimes(4);
  } finally {
    leave();
    poller.stop();
    vi.useRealTimers();
  }
});
