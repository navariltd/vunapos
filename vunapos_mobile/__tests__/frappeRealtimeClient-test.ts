import {
  CHECKOUT_QUEUE_EVENT,
  CONFIGURATION_EVENT,
  FrappeRealtimeClient,
  getFrappeRealtimeConnection,
  parsePosDomainResource,
} from "@/sync/frappeRealtimeClient";
import {
  invalidateRealtimeResource,
  registerRealtimeControlRefresh,
  registerRealtimeRefresh,
} from "@/sync/realtimeInvalidation";

function socketStub() {
  const listeners = new Map<string, (payload?: unknown) => void>();
  return {
    disconnect: jest.fn(),
    emit(event: string, payload?: unknown) {
      listeners.get(event)?.(payload);
    },
    off: jest.fn((event: string) => listeners.delete(event)),
    on: jest.fn((event: string, listener: (payload?: unknown) => void) => {
      listeners.set(event, listener);
    }),
  };
}

describe("FrappeRealtimeClient", () => {
  it("uses the direct Socket.IO port only for loopback bench sites", () => {
    expect(getFrappeRealtimeConnection("http://localhost:8000")).toEqual({
      siteName: "meru.localhost",
      url: "http://localhost:9000/meru.localhost",
    });
    expect(getFrappeRealtimeConnection("http://127.0.0.1:8000")).toEqual({
      siteName: "meru.localhost",
      url: "http://127.0.0.1:9000/meru.localhost",
    });
    expect(getFrappeRealtimeConnection("http://vuna.localhost:8000")).toEqual({
      siteName: "vuna.localhost",
      url: "http://vuna.localhost:9000/vuna.localhost",
    });
    expect(
      getFrappeRealtimeConnection("https://pos.example.com"),
    ).toEqual({
      siteName: "pos.example.com",
      url: "https://pos.example.com",
    });
  });

  it("owns one socket and debounces configuration invalidation events", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const factory = jest.fn(() => socket);
    const client = new FrappeRealtimeClient(factory);
    const refresh = jest.fn();
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refresh,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit(CONFIGURATION_EVENT, { resource: "referenceDataChanged" });
    socket.emit(CONFIGURATION_EVENT, { resource: "referenceDataChanged" });
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(350);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledWith({ resource: "referenceDataChanged" });

    expect(factory).toHaveBeenCalledWith(
      "https://pos.example.com",
      expect.objectContaining({
        extraHeaders: expect.objectContaining({
          Cookie: "sid=sid-1",
          "X-Frappe-Site-Name": "pos.example.com",
        }),
        transports: ["websocket", "polling"],
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);

    client.stop();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    unregister();
    jest.useRealTimers();
  });

  it("does not invoke removed resource handlers", () => {
    const refresh = jest.fn();
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refresh,
    );
    unregister();

    invalidateRealtimeResource("referenceDataChanged");

    expect(refresh).not.toHaveBeenCalled();
  });

  it("forwards checkout queue transitions to the app-owned resource", async () => {
    const socket = socketStub();
    const client = new FrappeRealtimeClient(() => socket);
    const refresh = jest.fn();
    const unregister = registerRealtimeRefresh("checkout-queue", refresh);

    client.start("https://pos.example.com", "sid-1");
    const payload = {
      invoice_name: "SINV-QUEUE-001",
      status: "Submitted",
    };
    socket.emit(CHECKOUT_QUEUE_EVENT, payload);
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledWith(payload);
    client.stop();
    unregister();
  });

  it("queues a follow-up configuration refresh when another event arrives mid-refresh", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const client = new FrappeRealtimeClient(() => socket);
    let resolveFirst: (() => void) | undefined;
    const refresh = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    const profileRefresh = jest.fn().mockResolvedValue(undefined);
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refresh,
    );
    const unregisterProfile = registerRealtimeControlRefresh(
      "posProfileChanged",
      profileRefresh,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit(CONFIGURATION_EVENT, { resource: "referenceDataChanged" });
    jest.advanceTimersByTime(350);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);

    socket.emit(CONFIGURATION_EVENT, { resource: "posProfileChanged" });
    resolveFirst?.();
    await jest.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(profileRefresh).toHaveBeenCalledTimes(1);

    client.stop();
    unregister();
    unregisterProfile();
    jest.useRealTimers();
  });

  it("repairs configuration through the timestamp delta after socket recovery", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const client = new FrappeRealtimeClient(() => socket);
    const refresh = jest.fn().mockResolvedValue(undefined);
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refresh,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit("connect");
    socket.emit("connect");
    jest.advanceTimersByTime(350);
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledWith(undefined);
    client.stop();
    unregister();
    jest.useRealTimers();
  });

  it("routes profile scope changes separately from ordinary reference changes", () => {
    expect(parsePosDomainResource({ resource: "referenceDataChanged" })).toBe(
      "referenceDataChanged",
    );
    expect(parsePosDomainResource({ resource: "posProfileChanged" })).toBe(
      "posProfileChanged",
    );
    expect(parsePosDomainResource({ doctype: "Item Price", refresh: "full" })).toBe(
      "referenceDataChanged",
    );
    expect(parsePosDomainResource({ resource: "unknown" })).toBe(
      "referenceDataChanged",
    );
  });
});
