import { describe, expect, it } from "vitest";
import { buildPaymentInputs } from "../paymentAllocation";
import { missingBankReference } from "../paymentReferences";
import type { ModeOfPaymentDTO } from "../types";

const modes: ModeOfPaymentDTO[] = [
  { mode_of_payment: "Cash" },
  { mode_of_payment: "Card", requires_reference: true },
  { mode_of_payment: "Transfer", requires_reference: true },
  {
    mode_of_payment: "M-Pesa",
    requires_reference: true,
    payment_gateway: "Gateway",
  },
];

describe("manual bank payment references", () => {
  it("requires a separate reference for each collected bank payment", () => {
    const amounts = { Cash: "10", Card: "40", Transfer: "50", "M-Pesa": "0" };
    expect(
      missingBankReference(modes, amounts, {}, 2, true)?.mode_of_payment
    ).toBe("Card");
    expect(
      missingBankReference(modes, amounts, { Card: "CARD-1" }, 2, true)
        ?.mode_of_payment
    ).toBe("Transfer");
    expect(
      missingBankReference(
        modes,
        amounts,
        { Card: "CARD-1", Transfer: "BANK-1" },
        2,
        true
      )
    ).toBeUndefined();
  });
  it("allows optional references without dropping entered values", () => {
    expect(
      missingBankReference(modes, { Card: "100" }, {}, 2, false)
    ).toBeUndefined();
    expect(
      buildPaymentInputs(modes, { Card: "100" }, 2, { Card: "  CARD-123  " })
    ).toEqual([
      { mode_of_payment: "Card", amount: 100, reference_no: "CARD-123" },
    ]);
  });
  it("does not require references for cash, gateways or unused payment modes", () => {
    expect(
      missingBankReference(
        modes,
        { Cash: "50", Card: "0", "M-Pesa": "50" },
        {},
        2,
        true
      )
    ).toBeUndefined();
    expect(
      buildPaymentInputs(modes, { Cash: "50", "M-Pesa": "50" }, 2, {
        Cash: "ignored",
        "M-Pesa": "unverified",
      })
    ).toEqual([
      { mode_of_payment: "Cash", amount: 50 },
      { mode_of_payment: "M-Pesa", amount: 50 },
    ]);
  });
  it("rejects whitespace-only references and leaves the date to the server", () => {
    expect(
      missingBankReference(modes, { Card: "100" }, { Card: "  " }, 2, true)
        ?.mode_of_payment
    ).toBe("Card");
    expect(
      buildPaymentInputs(modes, { Card: "100" }, 2, { Card: "CARD-1" })[0]
    ).not.toHaveProperty("reference_date");
  });
});
