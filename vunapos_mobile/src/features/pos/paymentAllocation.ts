import { PosPaymentMode } from '@/features/pos/types';

export type PaymentAmounts = Record<string, string>;

export type PaymentAllocation = {
  allocatedMinor: number;
  cashMinor: number;
  hasInvalidAmount: boolean;
  nonCashMinor: number;
  remainingMinor: number;
};

export function normalizeCurrencyPrecision(precision: number): number {
  return Number.isInteger(precision) && precision >= 0 && precision <= 6 ? precision : 2;
}

export function currencyScale(precision: number): number {
  return 10 ** normalizeCurrencyPrecision(precision);
}

export function totalToMinorUnits(total: number, precision: number): number {
  return Math.round(total * currencyScale(precision));
}

export function minorUnitsToInput(amountMinor: number, precision: number): string {
  const normalizedPrecision = normalizeCurrencyPrecision(precision);
  const scale = currencyScale(normalizedPrecision);
  const whole = Math.trunc(amountMinor / scale);
  if (!normalizedPrecision) return String(whole);
  const fraction = String(Math.abs(amountMinor % scale)).padStart(normalizedPrecision, '0');
  return `${whole}.${fraction}`;
}

/** Parses a non-negative decimal without floating-point rounding errors. */
export function parsePaymentAmount(amount: string, precision: number): number | null {
  const value = amount.trim();
  if (!value) return 0;
  if (!/^\d+(?:\.\d*)?$/.test(value)) return null;

  const normalizedPrecision = normalizeCurrencyPrecision(precision);
  const [wholePart, fractionPart = ''] = value.split('.');
  if (fractionPart.length > normalizedPrecision) return null;

  const scale = BigInt(currencyScale(normalizedPrecision));
  const paddedFraction = fractionPart.padEnd(normalizedPrecision, '0') || '0';
  const minor = BigInt(wholePart) * scale + BigInt(paddedFraction);
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function createInitialPaymentAmounts(modes: PosPaymentMode[], totalMinor: number, precision: number): PaymentAmounts {
  const defaultMode = modes.find((mode) => mode.default) || modes[0];
  return Object.fromEntries(modes.map((mode) => [
    mode.mode_of_payment,
    mode.mode_of_payment === defaultMode?.mode_of_payment ? minorUnitsToInput(totalMinor, precision) : '',
  ]));
}

export function allocateAllToMode(modes: PosPaymentMode[], modeOfPayment: string, totalMinor: number, precision: number): PaymentAmounts {
  return Object.fromEntries(modes.map((mode) => [
    mode.mode_of_payment,
    mode.mode_of_payment === modeOfPayment ? minorUnitsToInput(totalMinor, precision) : '',
  ]));
}

/** Moves the balance into the next manual mode when the profile enables it. */
export function allocatePaymentRemainderToNextMode(
  modes: PosPaymentMode[],
  amounts: PaymentAmounts,
  editedMode: string,
  totalMinor: number,
  precision: number,
): PaymentAmounts {
  const editedIndex = modes.findIndex((mode) => mode.mode_of_payment === editedMode);
  const nextMode = modes.slice(editedIndex + 1)[0];
  const editedAmount = parsePaymentAmount(amounts[editedMode] || '', precision);
  if (!nextMode || editedAmount === null) return amounts;
  const otherMinor = modes.reduce((sum, mode) => {
    if (mode.mode_of_payment === editedMode || mode.mode_of_payment === nextMode.mode_of_payment) return sum;
    return sum + (parsePaymentAmount(amounts[mode.mode_of_payment] || '', precision) || 0);
  }, 0);
  return { ...amounts, [nextMode.mode_of_payment]: minorUnitsToInput(Math.max(totalMinor - otherMinor - editedAmount, 0), precision) };
}

export function calculatePaymentAllocation(modes: PosPaymentMode[], amounts: PaymentAmounts, totalMinor: number, precision: number): PaymentAllocation {
  let allocatedMinor = 0;
  let cashMinor = 0;
  let nonCashMinor = 0;
  let hasInvalidAmount = false;
  for (const mode of modes) {
    const amount = parsePaymentAmount(amounts[mode.mode_of_payment] || '', precision);
    if (amount === null) {
      hasInvalidAmount = true;
      continue;
    }
    allocatedMinor += amount;
    if (mode.type === 'Cash') cashMinor += amount;
    else nonCashMinor += amount;
  }
  return { allocatedMinor, cashMinor, hasInvalidAmount, nonCashMinor, remainingMinor: totalMinor - allocatedMinor };
}

export function canCompletePaymentAllocation(allocation: PaymentAllocation, totalMinor: number, allowPartialPayment: boolean): boolean {
  return !allocation.hasInvalidAmount
    && allocation.allocatedMinor > 0
    && allocation.nonCashMinor <= totalMinor
    && (allocation.remainingMinor <= 0 || allowPartialPayment);
}

export function buildPaymentInputs(modes: PosPaymentMode[], amounts: PaymentAmounts, precision: number) {
  return modes.flatMap((mode) => {
    const amountMinor = parsePaymentAmount(amounts[mode.mode_of_payment] || '', precision);
    return amountMinor && amountMinor > 0
      ? [{ amount: amountMinor / currencyScale(precision), mode_of_payment: mode.mode_of_payment }]
      : [];
  });
}
