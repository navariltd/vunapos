import {
  CHECKOUT_QUEUE_EVENT,
  CONFIGURATION_EVENT,
  FrappeRealtimeClient,
  GATEWAY_PAYMENT_EVENT,
  getFrappeRealtimeConnection,
  parsePosDomainResource,
} from "@/sync/frappeRealtimeClient";
import {
  invalidateRealtimeResource,
  registerRealtimeControlRefresh,
  registerRealtimeRefresh,
} from "@/sync/realtimeInvalidation";
import * as realtimeInvalidation from "@/sync/realtimeInvalidation";

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
    expect(getFrappeRealtimeConnection("http://localhost:8000", "meru.localhost")).toEqual({
      siteName: "meru.localhost",
      url: "http://localhost:9000/meru.localhost",
    });
    expect(getFrappeRealtimeConnection("http://127.0.0.1:8000", "meru.localhost")).toEqual({
      siteName: "meru.localhost",
      url: "http://127.0.0.1:9000/meru.localhost",
    });
    expect(getFrappeRealtimeConnection("http://vuna.localhost:8000", "vuna.localhost")).toEqual({
      siteName: "vuna.localhost",
      url: "http://vuna.localhost:9000/vuna.localhost",
    });
    expect(getFrappeRealtimeConnection("http://10.0.2.2:8000", "meru.localhost")).toEqual({
      siteName: "meru.localhost",
      url: "http://10.0.2.2:9000/meru.localhost",
      hostHeader: "localhost:9000",
      originHeader: "http://localhost:8000",
    });
    expect(
      getFrappeRealtimeConnection("https://pos.example.com"),
    ).toEqual({
      siteName: "pos.example.com",
      url: "https://pos.example.com/pos.example.com",
    });
    expect(
      getFrappeRealtimeConnection("https://pos.example.com", "meru.localhost"),
    ).toEqual({
      siteName: "meru.localhost",
      url: "https://pos.example.com/meru.localhost",
    });
  });

  it("sends the bench host and site namespace headers for Android emulator access", () => {
    const socket = socketStub();
    const factory = jest.fn((_url: string, _options: Record<string, unknown>) => socket);
    const client = new FrappeRealtimeClient(factory);

    client.start("http://10.0.2.2:8000", "sid-1", "meru.localhost");

    expect(factory).toHaveBeenCalledWith(
      "http://10.0.2.2:9000/meru.localhost",
      expect.objectContaining({
        extraHeaders: expect.objectContaining({
          Cookie: "sid=sid-1",
          Host: "localhost:9000",
          Origin: "http://localhost:8000",
          "X-Frappe-Site-Name": "meru.localhost",
        }),
      }),
    );
    client.stop();
  });

  it("owns one socket and debounces configuration invalidation events", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const factory = jest.fn((_url: string, _options: Record<string, unknown>) => socket);
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
      "https://pos.example.com/pos.example.com",
      expect.objectContaining({
        extraHeaders: expect.objectContaining({
          Cookie: "sid=sid-1",
          "X-Frappe-Site-Name": "pos.example.com",
        }),
        transports: ["websocket", "polling"],
        reconnection: true,
      }),
    );
    expect(factory.mock.calls[0][1]).not.toHaveProperty("reconnectionAttempts");
    expect(refresh).toHaveBeenCalledTimes(1);

    client.stop();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    unregister();
    jest.useRealTimers();
  });

  it("delivers gateway changes through the same root socket and respects unsubscribe", () => {
    const socket = socketStub();
    const factory = jest.fn(() => socket);
    const client = new FrappeRealtimeClient(factory);
    const paymentListener = jest.fn();
    const unsubscribe = client.subscribeGatewayPayment(paymentListener);

    client.start("https://pos.example.com", "sid-1", "meru.localhost");
    socket.emit(GATEWAY_PAYMENT_EVENT, { name: "GATEWAY-001", status: "Paid" });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(paymentListener).toHaveBeenCalledWith({ name: "GATEWAY-001", status: "Paid" });

    unsubscribe();
    socket.emit(GATEWAY_PAYMENT_EVENT, { name: "GATEWAY-002", status: "Failed" });
    expect(paymentListener).toHaveBeenCalledTimes(1);
    client.stop();
    expect(socket.off).toHaveBeenCalledWith(GATEWAY_PAYMENT_EVENT, expect.any(Function));
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

  it("repairs reference data and operational resources after socket reconnect", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const client = new FrappeRealtimeClient(() => socket);
    const refresh = jest.fn().mockResolvedValue(undefined);
    const refreshOperational = jest
      .spyOn(realtimeInvalidation, "refreshOperationalPosResources")
      .mockResolvedValue(undefined);
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refresh,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit("connect");
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshOperational).not.toHaveBeenCalled();
    socket.emit("connect");
    await jest.advanceTimersByTimeAsync(350);

    expect(refresh).toHaveBeenCalledWith(undefined);
    expect(refreshOperational).toHaveBeenCalledTimes(1);
    client.stop();
    unregister();
    refreshOperational.mockRestore();
    jest.useRealTimers();
  });

  it("lets a profile change supersede reference repair during reconnect", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const client = new FrappeRealtimeClient(() => socket);
    const refreshReference = jest.fn().mockResolvedValue(undefined);
    const refreshProfile = jest.fn().mockResolvedValue(undefined);
    const refreshOperational = jest
      .spyOn(realtimeInvalidation, "refreshOperationalPosResources")
      .mockResolvedValue(undefined);
    const unregisterReference = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refreshReference,
    );
    const unregisterProfile = registerRealtimeControlRefresh(
      "posProfileChanged",
      refreshProfile,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit("connect");
    socket.emit("connect");
    socket.emit(CONFIGURATION_EVENT, { resource: "posProfileChanged" });
    await jest.advanceTimersByTimeAsync(350);

    expect(refreshReference).not.toHaveBeenCalled();
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    expect(refreshOperational).toHaveBeenCalledTimes(1);
    client.stop();
    unregisterReference();
    unregisterProfile();
    refreshOperational.mockRestore();
    jest.useRealTimers();
  });

  it("does not repair operational data for a stopped session", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const client = new FrappeRealtimeClient(() => socket);
    let finishReference: (() => void) | undefined;
    const refreshReference = jest.fn(
      () => new Promise<void>((resolve) => { finishReference = resolve; }),
    );
    const refreshOperational = jest
      .spyOn(realtimeInvalidation, "refreshOperationalPosResources")
      .mockResolvedValue(undefined);
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      refreshReference,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit("connect");
    socket.emit("connect");
    jest.advanceTimersByTime(350);
    expect(refreshReference).toHaveBeenCalledTimes(1);

    client.stop();
    finishReference?.();
    await jest.runAllTimersAsync();
    expect(refreshOperational).not.toHaveBeenCalled();

    unregister();
    refreshOperational.mockRestore();
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
