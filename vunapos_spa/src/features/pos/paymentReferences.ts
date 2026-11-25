import type { ModeOfPaymentDTO } from "./types";
import { parsePaymentAmount, type PaymentAmounts } from "./paymentAllocation";

export function missingBankReference(
  modes: ModeOfPaymentDTO[],
  amounts: PaymentAmounts,
  references: Record<string, string>,
  precision: number,
  required: boolean
) {
  if (!required) return undefined;
  return modes.find(
    (mode) =>
      mode.requires_reference &&
      !mode.payment_gateway &&
      (parsePaymentAmount(amounts[mode.mode_of_payment] || "", precision) ||
        0) > 0 &&
      !references[mode.mode_of_payment]?.trim()
  );
}
