import type { ModeOfPaymentDTO, PaymentInput } from "./types";

export type PaymentAmounts = Record<string, string>;

export type PaymentAllocation = {
	allocatedMinor: number;
	cashMinor: number;
	nonCashMinor: number;
	remainingMinor: number;
	hasInvalidAmount: boolean;
};

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
	const fraction = String(Math.abs(amountMinor % scale)).padStart(normalizedPrecision, "0");
	return `${whole}.${fraction}`;
}

export function parsePaymentAmount(amount: string, precision: number): number | null {
	const value = amount.trim();
	if (!value) return 0;
	if (!/^\d+(?:\.\d*)?$/.test(value)) return null;

	const normalizedPrecision = normalizeCurrencyPrecision(precision);
	const [wholePart, fractionPart = ""] = value.split(".");
	if (fractionPart.length > normalizedPrecision) return null;

	const scale = BigInt(currencyScale(normalizedPrecision));
	const paddedFraction = fractionPart.padEnd(normalizedPrecision, "0") || "0";
	const minor = BigInt(wholePart) * scale + BigInt(paddedFraction);
	if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	return Number(minor);
}

export function createInitialPaymentAmounts(
	modes: ModeOfPaymentDTO[],
	totalMinor: number,
	precision: number,
): PaymentAmounts {
	const defaultMode = modes.find((mode) => mode.default) || modes[0];
	const defaultManualMode = modes.find((mode) => !mode.payment_gateway && mode.default)
		|| modes.find((mode) => !mode.payment_gateway);
	return Object.fromEntries(
		modes.map((mode) => [
			mode.mode_of_payment,
			mode.mode_of_payment === (defaultManualMode || defaultMode)?.mode_of_payment && !mode.payment_gateway
				? minorUnitsToInput(totalMinor, precision)
				: "",
		]),
	);
}

export function allocateAllToMode(
	modes: ModeOfPaymentDTO[],
	modeOfPayment: string,
	totalMinor: number,
	precision: number,
): PaymentAmounts {
	return Object.fromEntries(
		modes.map((mode) => [
			mode.mode_of_payment,
			mode.mode_of_payment === modeOfPayment && !mode.payment_gateway ? minorUnitsToInput(totalMinor, precision) : "",
		]),
	);
}

export function calculatePaymentAllocation(
	modes: ModeOfPaymentDTO[],
	amounts: PaymentAmounts,
	totalMinor: number,
	precision: number,
): PaymentAllocation {
	let allocatedMinor = 0;
	let cashMinor = 0;
	let nonCashMinor = 0;
	let hasInvalidAmount = false;
	for (const mode of modes) {
		const parsed = parsePaymentAmount(amounts[mode.mode_of_payment] || "", precision);
		if (parsed === null) {
			hasInvalidAmount = true;
			continue;
		}
		allocatedMinor += parsed;
		if (mode.type === "Cash") cashMinor += parsed;
		else nonCashMinor += parsed;
	}
	return { allocatedMinor, cashMinor, nonCashMinor, remainingMinor: totalMinor - allocatedMinor, hasInvalidAmount };
}

export function canCompletePaymentAllocation(
	allocation: PaymentAllocation,
	totalMinor: number,
	allowPartialPayment: boolean,
): boolean {
	return (
		!allocation.hasInvalidAmount &&
		allocation.allocatedMinor > 0 &&
		allocation.nonCashMinor <= totalMinor &&
		(allocation.remainingMinor <= 0 || allowPartialPayment)
	);
}

export function buildPaymentInputs(
	modes: ModeOfPaymentDTO[],
	amounts: PaymentAmounts,
	precision: number,
): PaymentInput[] {
	return modes.flatMap((mode) => {
		const amountMinor = parsePaymentAmount(amounts[mode.mode_of_payment] || "", precision);
		return amountMinor && amountMinor > 0
			? [{ mode_of_payment: mode.mode_of_payment, amount: amountMinor / currencyScale(precision) }]
			: [];
	});
}

export function normalizeCurrencyPrecision(precision: number): number {
	return Number.isInteger(precision) && precision >= 0 && precision <= 6 ? precision : 2;
}
