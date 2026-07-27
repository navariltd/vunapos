import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Pause, Trash2, X } from "lucide-react";

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
	onClear: () => void;
	onClose: () => void;
	onConfirm: (payments: PaymentInput[], idempotencyKey: string) => void;
	onHold: () => void;
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
	onClear,
	onClose,
	onConfirm,
	onHold,
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
			onClear={onClear}
			onClose={onClose}
			onConfirm={onConfirm}
			onHold={onHold}
		/>
	);
}

function CheckoutDialogContent({
	allowPartialPayment,
	currency,
	currencyPrecision,
	error,
	modesOfPayment,
	onClear,
	onClose,
	onConfirm,
	onHold,
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
	const paymentStatus = allocation.hasInvalidAmount
		? "Invalid allocation"
		: allocation.remainingMinor < 0
			? "Change due"
			: allocation.remainingMinor === 0
				? "Fully paid"
				: allowPartialPayment && allocation.allocatedMinor > 0
					? "Partial payment"
					: "Payment incomplete";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-2 sm:p-4">
			<div className="flex h-[calc(100dvh-1rem)] max-h-[52rem] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-lg sm:h-[calc(100dvh-2rem)]">
				<div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant px-4 py-4 sm:px-6">
					<div>
						<h2 className="text-lg font-semibold text-on-surface">Checkout</h2>
						<p className="text-sm text-on-surface-variant">
							Invoice {invoice?.is_local ? "#Draft" : invoice?.name || "#Draft"}
						</p>
					</div>
					<button type="button" className="rounded-md p-2 hover:bg-surface-container" onClick={onClose}>
						<X className="size-5" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
					<div className="grid min-h-full lg:h-full lg:min-h-0 lg:grid-cols-2 lg:divide-x lg:divide-outline-variant">
					<section className="flex min-h-0 flex-col p-4 sm:p-6">
						<p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Amount due</p>
						<p className="mt-1 text-3xl font-semibold text-on-surface">{formatCurrency(total, currency, precision)}</p>
						<div className="mt-6 max-h-64 min-h-0 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
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
								<div
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
								</div>
							);
						})}
						</div>
						<div className="mt-5 grid gap-3 sm:grid-cols-3">
							<PaymentSummary label="Allocated" value={formatCurrency(allocation.allocatedMinor / scale, currency, precision)} />
							<PaymentSummary label={balanceLabel} value={formatCurrency(balanceMinor / scale, currency, precision)} invalid={allocation.hasInvalidAmount || hasNonCashOverpayment || (allocation.remainingMinor > 0 && !allowPartialPayment)} />
							<PaymentSummary label="Status" value={paymentStatus} invalid={!isPayable} compact />
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
					</section>
					<InvoiceSummary invoice={invoice} currency={currency} precision={precision} allocatedMinor={allocation.allocatedMinor} remainingMinor={allocation.remainingMinor} />
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-outline-variant px-4 py-3 sm:px-6">
					<Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Back</Button>
					<Button variant="danger" className="gap-2" onClick={onClear} disabled={isSubmitting}>
						<Trash2 className="size-4" /> Clear
					</Button>
					<Button variant="ghost" className="ml-auto min-w-28 gap-2 bg-tertiary text-on-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container" onClick={onHold} disabled={isSubmitting}>
						<Pause className="size-4" /> Hold
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

function InvoiceSummary({
	invoice,
	currency,
	precision,
	allocatedMinor,
	remainingMinor,
}: {
	invoice: ReturnType<typeof useCartStore.getState>["invoice"];
	currency?: string;
	precision: number;
	allocatedMinor: number;
	remainingMinor: number;
}) {
	const scale = currencyScale(precision);
	const taxes = invoice?.taxes || [];
	return (
		<section className="flex flex-col bg-surface-container-low p-4 sm:p-6 lg:min-h-0">
			<h3 className="font-semibold text-on-surface">Invoice summary</h3>
			<div className="mt-4">
				<p className="text-xs text-on-surface-variant">Customer</p>
				<p className="font-medium text-on-surface">{invoice?.customer_name || invoice?.customer || "Walk-in Customer"}</p>
			</div>
			<div className="mt-5 flex min-h-0 flex-1 flex-col">
				<p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Items</p>
				<div className="mt-2 max-h-56 min-h-0 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
					{invoice?.items?.map((item) => (
						<div key={item.row_name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-sm">
							<span className="truncate text-on-surface">{item.item_name}</span>
							<span className="text-on-surface-variant">×{item.qty}</span>
							<span className="font-medium text-on-surface">{formatCurrency(item.amount, currency, precision)}</span>
						</div>
					))}
				</div>
			</div>
			<div className="mt-5 space-y-2 border-t border-outline-variant pt-4 text-sm">
				<SummaryRow label="Subtotal" value={formatCurrency(invoice?.totals.net_total, currency, precision)} />
				{taxes.map((tax, index) => (
					<SummaryRow key={`${tax.account_head || tax.description}-${index}`} label={`${tax.description || tax.account_head || "Tax"}${tax.rate ? ` ${tax.rate}%` : ""}`} value={formatCurrency(tax.tax_amount, currency, precision)} />
				))}
				<SummaryRow label="Grand total" value={formatCurrency(getInvoiceTotal(invoice), currency, precision)} strong />
				<SummaryRow label="Paid" value={formatCurrency(allocatedMinor / scale, currency, precision)} />
				<SummaryRow label={remainingMinor < 0 ? "Change" : "Balance"} value={formatCurrency(Math.abs(remainingMinor) / scale, currency, precision)} strong />
			</div>
		</section>
	);
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
	return <div className={`flex justify-between gap-4 ${strong ? "font-semibold text-on-surface" : "text-on-surface-variant"}`}><span>{label}</span><span className="text-on-surface">{value}</span></div>;
}

function PaymentSummary({
	label,
	value,
	invalid = false,
	compact = false,
}: {
	label: string;
	value: string;
	invalid?: boolean;
	compact?: boolean;
}) {
	return (
		<div className={`rounded-md p-3 ${invalid ? "bg-error-container" : "bg-surface-container-low"}`}>
			<p className={`text-xs ${invalid ? "text-on-error-container" : "text-on-surface-variant"}`}>{label}</p>
			<p className={`mt-1 whitespace-nowrap font-semibold ${compact ? "text-sm" : ""} ${invalid ? "text-on-error-container" : "text-on-surface"}`}>{value}</p>
		</div>
	);
}
