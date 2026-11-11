import {
  clearQueuedCheckouts,
  registerQueuedCheckout,
  takeQueuedCheckout,
} from "@/sync/queuedCheckoutRegistry";

describe("queued checkout registry", () => {
  beforeEach(clearQueuedCheckouts);

  it("never hands a prior site's or SID's queued cart to the current session", () => {
    const checkout = { items: [], posProfile: "POS-A" };
    registerQueuedCheckout("https://site-a.example", "sid-a", "QUEUE-1", checkout);

    expect(takeQueuedCheckout("https://site-b.example", "sid-a", "QUEUE-1")).toBeUndefined();
    expect(takeQueuedCheckout("https://site-a.example", "sid-b", "QUEUE-1")).toBeUndefined();
    expect(takeQueuedCheckout("https://site-a.example", "sid-a", "QUEUE-1")).toBe(checkout);
    expect(takeQueuedCheckout("https://site-a.example", "sid-a", "QUEUE-1")).toBeUndefined();
  });
});
