import {
  invalidateRealtimeResource,
  registerRealtimeControlRefresh,
  registerRealtimeRefresh,
} from "@/sync/realtimeInvalidation";

describe("realtime invalidation ownership", () => {
  it("delivers control events without any mounted feature handler", async () => {
    const rootRefresh = jest.fn();
    const unregister = registerRealtimeControlRefresh(
      "workspace-configuration",
      rootRefresh,
    );

    await invalidateRealtimeResource("workspace-configuration", {
      resource: "referenceDataChanged",
    });

    expect(rootRefresh).toHaveBeenCalledWith({
      resource: "referenceDataChanged",
    });
    unregister();
  });

  it("does not route control events to screen-owned resource handlers", async () => {
    const screenRefresh = jest.fn();
    const rootRefresh = jest.fn();
    const unregisterScreen = registerRealtimeRefresh(
      "workspace-configuration",
      screenRefresh,
    );
    const unregisterRoot = registerRealtimeControlRefresh(
      "workspace-configuration",
      rootRefresh,
    );

    await invalidateRealtimeResource("workspace-configuration");

    expect(rootRefresh).toHaveBeenCalledTimes(1);
    expect(screenRefresh).not.toHaveBeenCalled();
    unregisterScreen();
    unregisterRoot();
  });
});

