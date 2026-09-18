import { normalizeCurrencyPrecision } from "@/features/pos/paymentAllocation";

/** Formats operational monetary values using the active POS profile precision. */
export function formatPosCurrency(
  amount: number | null | undefined,
  currency = "KES",
  precision = 2,
) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const normalizedPrecision = normalizeCurrencyPrecision(precision);

  return new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: "code",
    maximumFractionDigits: normalizedPrecision,
    minimumFractionDigits: normalizedPrecision,
    style: "currency",
  }).format(normalizedAmount);
}
