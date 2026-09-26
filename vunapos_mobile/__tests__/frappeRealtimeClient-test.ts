import {
  CHECKOUT_QUEUE_EVENT,
  CONFIGURATION_EVENT,
  FrappeRealtimeClient,
  getFrappeRealtimeConnection,
} from "@/sync/frappeRealtimeClient";
import {
  invalidateRealtimeResource,
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
      url: "https://pos.example.com/pos.example.com",
    });
  });

  it("owns one socket and debounces configuration invalidation events", async () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const factory = jest.fn(() => socket);
    const client = new FrappeRealtimeClient(factory);
    const refresh = jest.fn();
    const unregister = registerRealtimeRefresh(
      "workspace-configuration",
      refresh,
    );

    client.start("https://pos.example.com", "sid-1");
    socket.emit(CONFIGURATION_EVENT, { refresh: "full" });
    socket.emit(CONFIGURATION_EVENT, { refresh: "full" });
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(350);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledWith({ refresh: "full" });

    expect(factory).toHaveBeenCalledWith(
      "https://pos.example.com/pos.example.com",
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
    const unregister = registerRealtimeRefresh(
      "workspace-configuration",
      refresh,
    );
    unregister();

    invalidateRealtimeResource("workspace-configuration");

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
});
