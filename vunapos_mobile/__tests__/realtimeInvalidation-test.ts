import {
  invalidateRealtimeResource,
  registerRealtimeControlRefresh,
  registerRealtimeRefresh,
} from "@/sync/realtimeInvalidation";

describe("realtime invalidation ownership", () => {
  it("delivers control events without any mounted feature handler", async () => {
    const rootRefresh = jest.fn();
    const unregister = registerRealtimeControlRefresh(
      "referenceDataChanged",
      rootRefresh,
    );

    await invalidateRealtimeResource("referenceDataChanged", {
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
      "posProfileChanged",
      screenRefresh,
    );
    const unregisterRoot = registerRealtimeControlRefresh(
      "referenceDataChanged",
      rootRefresh,
    );

    await invalidateRealtimeResource("referenceDataChanged");

    expect(rootRefresh).toHaveBeenCalledTimes(1);
    expect(screenRefresh).not.toHaveBeenCalled();
    unregisterScreen();
    unregisterRoot();
  });
});
