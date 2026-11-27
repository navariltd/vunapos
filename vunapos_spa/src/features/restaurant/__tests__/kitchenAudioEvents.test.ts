import { describe, expect, it, vi } from "vitest";
import { createKitchenAudioEventHandlers } from "../kitchenAudioEvents";

describe("kitchen audio events", () => {
  it("identifies correction and failure alerts for the shared sound engine", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);
    const event = {
      name: "ACTION-1",
      kitchen_station: "Kitchen",
      action: "Update preparation notes",
    };
    handlers.action(event);
    handlers.action(event);
    expect(play).toHaveBeenCalledExactlyOnceWith("alert", "action:ACTION-1");
    handlers.printJob({
      name: "JOB-1",
      kitchen_station: "Kitchen",
      status: "Failed",
    });
    handlers.printJob({
      name: "JOB-1",
      kitchen_station: "Kitchen",
      status: "Failed",
    });
    expect(play).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenLastCalledWith(
      "alert",
      expect.stringContaining("print:JOB-1:Failed:")
    );
  });
  it("plays arrival sound once per ticket", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    const event = {
      name: "KOT-001",
      kitchen_station: "Kitchen",
    };

    handlers.arrival(event);
    handlers.arrival(event);

    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("new", "KOT-001");
  });

  it("ignores arrivals from unrelated stations", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    handlers.arrival({
      name: "KOT-002",
      kitchen_station: "Bar",
    });

    expect(play).not.toHaveBeenCalled();
  });

  it("alerts once when a print job becomes uncertain", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    const event = {
      name: "PRINT-001",
      kitchen_station: "Kitchen",
    };

    handlers.printJob({ ...event, status: "Queued" });
    handlers.printJob({ ...event, status: "Sending" });
    handlers.printJob({ ...event, status: "Uncertain" });
    handlers.printJob({ ...event, status: "Uncertain" });

    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("alert", expect.any(String));
  });

  it("alerts again if a retried job becomes uncertain", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    const event = {
      name: "PRINT-002",
      kitchen_station: "Kitchen",
    };

    handlers.printJob({ ...event, status: "Uncertain" });
    handlers.printJob({ ...event, status: "Queued" });
    handlers.printJob({ ...event, status: "Sending" });
    handlers.printJob({ ...event, status: "Uncertain" });

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not alert for uncertain jobs belonging to other stations", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    handlers.printJob({
      name: "PRINT-003",
      kitchen_station: "Bar",
      status: "Uncertain",
    });

    expect(play).not.toHaveBeenCalled();
  });

  it("alerts for cancellation actions only", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    handlers.action({
      kitchen_station: "Kitchen",
      action: "Serve",
    });

    handlers.action({
      kitchen_station: "Kitchen",
      action: "Cancel Items",
    });

    handlers.action({
      kitchen_station: "Kitchen",
      action: "Stop Preparation",
    });

    expect(play).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenNthCalledWith(1, "alert", expect.any(String));
    expect(play).toHaveBeenNthCalledWith(2, "alert", expect.any(String));
  });

  it("ignores cancellation actions from unrelated stations", () => {
    const play = vi.fn();
    const handlers = createKitchenAudioEventHandlers(["Kitchen"], play);

    handlers.action({
      kitchen_station: "Bar",
      action: "Cancel Order",
    });

    expect(play).not.toHaveBeenCalled();
  });
});
