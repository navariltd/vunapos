import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import {
	allocateAllToMode,
	buildPaymentInputs,
	canCompletePaymentAllocation,
	calculatePaymentAllocation,
	createInitialPaymentAmounts,
	currencyScale,
	minorUnitsToInput,
	normalizeCurrencyPrecision,
	parsePaymentAmount,
	totalToMinorUnits,
} from "../paymentAllocation";
import { useCartStore } from "../stores/cartStore";
import type { ModeOfPaymentDTO, PaymentInput } from "../types";
import { formatCurrency, getInvoiceTotal } from "../utils";

type CheckoutDialogProps = {
	allowPartialPayment?: boolean;
	currency?: string;
	currencyPrecision?: number;
	error?: string | null;
	isOpen: boolean;
	modesOfPayment: ModeOfPaymentDTO[];
	onClose: () => void;
	onConfirm: (payments: PaymentInput[], idempotencyKey: string) => void;
};

function createIdempotencyKey() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CheckoutDialog({
	allowPartialPayment,
	currency,
	currencyPrecision,
	error,
	isOpen,
	modesOfPayment,
	onClose,
	onConfirm,
}: CheckoutDialogProps) {
	if (!isOpen) {
		return null;
	}

	return (
		<CheckoutDialogContent
			allowPartialPayment={allowPartialPayment}
			currency={currency}
			currencyPrecision={currencyPrecision}
			error={error}
			modesOfPayment={modesOfPayment}
			onClose={onClose}
			onConfirm={onConfirm}
		/>
	);
}

function CheckoutDialogContent({
	allowPartialPayment,
	currency,
	currencyPrecision,
	error,
	modesOfPayment,
	onClose,
	onConfirm,
}: Omit<CheckoutDialogProps, "isOpen">) {
	const invoice = useCartStore((s) => s.invoice);
	const isSubmitting = useCartStore((s) => s.isMutating);
	const total = getInvoiceTotal(invoice);
	const precision = normalizeCurrencyPrecision(currencyPrecision ?? 2);
	const availableModes = useMemo(
		() => Array.from(new Map(modesOfPayment.map((mode) => [mode.mode_of_payment, mode])).values()),
		[modesOfPayment],
	);
	const totalMinor = totalToMinorUnits(total, precision);
	const [amounts, setAmounts] = useState(() =>
		createInitialPaymentAmounts(availableModes, totalMinor, precision),
	);
	const idempotencyKey = useRef(createIdempotencyKey());
	const allocation = calculatePaymentAllocation(availableModes, amounts, totalMinor, precision);
	const hasNonCashOverpayment = allocation.nonCashMinor > totalMinor;
	const isPayable =
		availableModes.length > 0 &&
		canCompletePaymentAllocation(allocation, totalMinor, Boolean(allowPartialPayment));
	const scale = currencyScale(precision);
	const isOverpaid = allocation.remainingMinor < 0;
	const balanceLabel = isOverpaid ? "Change" : allocation.remainingMinor > 0 && allowPartialPayment ? "Outstanding" : "Remaining";
	const balanceMinor = Math.abs(allocation.remainingMinor);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
			<div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-outline-variant bg-surface p-5 shadow-lg">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold text-on-surface">Checkout</h2>
						<p className="text-sm text-on-surface-variant">Allocate the amount across the available payment modes.</p>
					</div>
					<button type="button" className="rounded-md p-2 hover:bg-surface-container" onClick={onClose}>
						<X className="size-5" />
					</button>
				</div>
				<div className="mt-5 space-y-4">
					<div className="grid gap-3 sm:grid-cols-3">
						<PaymentSummary label="Amount due" value={formatCurrency(total, currency, precision)} />
						<PaymentSummary
							label="Allocated"
							value={formatCurrency(allocation.allocatedMinor / scale, currency, precision)}
						/>
						<PaymentSummary
							label={balanceLabel}
							value={formatCurrency(balanceMinor / scale, currency, precision)}
							invalid={allocation.hasInvalidAmount || hasNonCashOverpayment || (allocation.remainingMinor > 0 && !allowPartialPayment)}
						/>
					</div>
					<div className="space-y-2">
						{availableModes.map((mode) => {
							const amount = amounts[mode.mode_of_payment] ?? "";
							const isAll =
								parsePaymentAmount(amount, precision) === totalMinor &&
								availableModes.every(
									(other) =>
										other.mode_of_payment === mode.mode_of_payment ||
										parsePaymentAmount(amounts[other.mode_of_payment] || "", precision) === 0,
								);
							return (
								<label
									key={mode.mode_of_payment}
									className="grid items-center gap-2 rounded-md border border-outline-variant bg-surface-container-low p-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_auto]"
								>
									<span className="text-sm font-medium text-on-surface">
										{mode.mode_of_payment}
										{mode.default ? <span className="ml-2 text-xs text-on-surface-variant">Default</span> : null}
									</span>
									<input
										aria-label={`${mode.mode_of_payment} amount`}
										className="h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-right text-sm"
										inputMode="decimal"
										placeholder={minorUnitsToInput(0, precision)}
										value={amount}
										onChange={(event) =>
											setAmounts((current) => ({
												...current,
												[mode.mode_of_payment]: event.target.value,
											}))
										}
									/>
									<button
										type="button"
										aria-label={`Allocate all to ${mode.mode_of_payment}`}
										aria-pressed={isAll}
										title={`Allocate the full amount to ${mode.mode_of_payment}`}
										className={`inline-flex h-touch items-center justify-center gap-1 rounded-md px-3 text-xs font-medium ${
											isAll
												? "bg-secondary text-on-secondary"
												: "bg-surface-container text-on-surface hover:bg-surface-container-high"
										}`}
										onClick={() =>
											setAmounts(allocateAllToMode(availableModes, mode.mode_of_payment, totalMinor, precision))
										}
									>
										<Check className="size-4" /> All
									</button>
								</label>
							);
						})}
					</div>
					{allocation.hasInvalidAmount ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> Enter valid amounts with no more than {precision} decimal places.
						</div>
					) : null}
					{hasNonCashOverpayment ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> Electronic payments cannot exceed the amount due.
						</div>
					) : null}
					{allocation.remainingMinor > 0 && allowPartialPayment ? (
						<p className="text-sm text-on-surface-variant">
							Partial payment is enabled.
						</p>
					) : null}
					{error ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> {error}
						</div>
					) : null}
				</div>
				<div className="mt-6 flex justify-end gap-3">
					<Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
						Cancel
					</Button>
					<Button
						disabled={!isPayable || isSubmitting}
						onClick={() =>
							onConfirm(buildPaymentInputs(availableModes, amounts, precision), idempotencyKey.current)
						}
					>
						{isSubmitting ? "Submitting..." : "Complete sale"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function PaymentSummary({
	label,
	value,
	invalid = false,
}: {
	label: string;
	value: string;
	invalid?: boolean;
}) {
	return (
		<div className={`rounded-md p-3 ${invalid ? "bg-error-container" : "bg-surface-container-low"}`}>
			<p className={`text-xs ${invalid ? "text-on-error-container" : "text-on-surface-variant"}`}>{label}</p>
			<p className={`mt-1 font-semibold ${invalid ? "text-on-error-container" : "text-on-surface"}`}>{value}</p>
		</div>
	);
}
