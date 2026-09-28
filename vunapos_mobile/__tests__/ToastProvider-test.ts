import {
  CONNECTION_TOAST_MESSAGE,
  isConnectionFailureMessage,
} from "@/components/feedback/ToastProvider";

describe("ToastProvider connection presentation", () => {
  it.each([
    "Could not reach your company site. Check your connection and try again.",
    "The request timed out. Check your connection and try again.",
    "Network request failed",
    "Connection unavailable. Reconnect before submitting this sale.",
  ])("recognizes transport failure: %s", (message) => {
    expect(isConnectionFailureMessage(message)).toBe(true);
  });

  it("does not classify server validation messages as connection failures", () => {
    expect(isConnectionFailureMessage("Insufficient stock for ITEM-001.")).toBe(
      false,
    );
    expect(isConnectionFailureMessage("You do not have permission.")).toBe(false);
  });

  it("uses one stable connection toast message", () => {
    expect(CONNECTION_TOAST_MESSAGE).toContain("connection was interrupted");
  });
});
