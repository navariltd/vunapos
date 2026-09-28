import { formatPosCurrency } from "@/features/pos/currency";

describe("formatPosCurrency", () => {
  it("uses the active POS currency and its configured precision", () => {
    expect(formatPosCurrency(12.3456, "USD", 3)).toContain("12.346");
    expect(formatPosCurrency(12.6, "JPY", 0)).toContain("13");
  });

  it("normalizes unsafe values and an invalid precision", () => {
    expect(formatPosCurrency(undefined, "KES", 99)).toContain("0.00");
  });
});
