import { describe, it, expect } from "vitest";
import { recoveredAmounts, recoveryProblem } from "../gatewayRecovery";
import type { GatewayPaymentLinkDTO, ModeOfPaymentDTO } from "../types";

const modes: ModeOfPaymentDTO[] = [
  { mode_of_payment: "Cash", default: 1 },
  { mode_of_payment: "M-Pesa", payment_gateway: "Gateway" },
];
const link = {
  name: "L1",
  mode_of_payment: "M-Pesa",
  payment_gateway: "Gateway",
  amount: 200,
  status: "Paid",
} as GatewayPaymentLinkDTO;

describe("gateway receipt recovery", () => {
  it("restores the actual partial receipt and only allocates the remainder to cash", () => {
    expect(recoveredAmounts(modes, [link], 30000, 2)).toEqual({
      "M-Pesa": "200.00",
      Cash: "100.00",
    });
    expect(recoveryProblem([link], modes, 30000, 2)).toBeNull();
  });
  it("does not silently transfer money to another shift", () => {
    expect(
      recoveryProblem([{ ...link, handover_required: true }], modes, 30000, 2)
    ).toContain("handover");
  });
  it("blocks overpayment, duplicate modes and changed gateway accounts for review", () => {
    expect(recoveryProblem([link], modes, 10000, 2)).toContain("exceed");
    expect(
      recoveryProblem([link, { ...link, name: "L2" }], modes, 50000, 2)
    ).toContain("same payment mode");
    expect(
      recoveryProblem([{ ...link, payment_gateway: "Other" }], modes, 30000, 2)
    ).toContain("configured gateway");
  });
  it("supports distinct gateway modes without requiring each receipt to equal the bill", () => {
    const allModes = [
      ...modes,
      { mode_of_payment: "Card", payment_gateway: "Card Gateway" },
    ];
    const receipts = [
      link,
      {
        ...link,
        name: "L2",
        mode_of_payment: "Card",
        payment_gateway: "Card Gateway",
        amount: 100,
      },
    ];
    expect(recoveryProblem(receipts, allModes, 30000, 2)).toBeNull();
    expect(recoveredAmounts(allModes, receipts, 30000, 2)).toEqual({
      "M-Pesa": "200.00",
      Card: "100.00",
      Cash: "",
    });
  });
});
