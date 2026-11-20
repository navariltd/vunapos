import type { GatewayPaymentLinkDTO, ModeOfPaymentDTO } from "./types";
import { minorUnitsToInput, totalToMinorUnits } from "./paymentAllocation";

export function recoveryProblem(
  links: GatewayPaymentLinkDTO[],
  modes: ModeOfPaymentDTO[],
  payableMinor: number,
  precision: number
): string | null {
  if (links.some((link) => link.handover_required))
    return "An earlier payment needs manager-approved handover to this cashier and shift. Do not take another payment.";
  if (new Set(links.map((link) => link.mode_of_payment)).size !== links.length)
    return "Several receipts use the same payment mode. Ask accounts to reconcile them before checkout.";
  if (
    links.some(
      (link) =>
        !Number.isFinite(link.amount) ||
        link.amount <= 0 ||
        !modes.some(
          (mode) =>
            mode.mode_of_payment === link.mode_of_payment &&
            mode.payment_gateway === link.payment_gateway
        )
    )
  )
    return "An earlier payment does not match this profile's configured gateway. Ask a manager to review it.";
  if (
    links.reduce(
      (sum, link) => sum + totalToMinorUnits(link.amount, precision),
      0
    ) > payableMinor
  )
    return "Earlier payments exceed the current bill. Ask accounts to review the excess; do not charge again.";
  return null;
}

export function recoveredAmounts(
  modes: ModeOfPaymentDTO[],
  links: GatewayPaymentLinkDTO[],
  payableMinor: number,
  precision: number
): Record<string, string> {
  const amounts = Object.fromEntries(
    modes.map((mode) => [mode.mode_of_payment, ""])
  );
  let remaining = payableMinor;
  for (const link of links) {
    const minor = totalToMinorUnits(link.amount, precision);
    amounts[link.mode_of_payment] = minorUnitsToInput(minor, precision);
    remaining -= minor;
  }
  const ordinary =
    modes.find((mode) => mode.default && !mode.payment_gateway) ||
    modes.find((mode) => !mode.payment_gateway);
  if (ordinary && remaining > 0)
    amounts[ordinary.mode_of_payment] = minorUnitsToInput(remaining, precision);
  return amounts;
}
