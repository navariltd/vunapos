import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { InvoiceDTO, ModeOfPaymentDTO, PaymentInput } from "../types";
import { formatCurrency, getInvoiceTotal } from "../utils";

type CheckoutDialogProps = {
	currency?: string;
	invoice: InvoiceDTO | null;
	isOpen: boolean;
	isSubmitting?: boolean;
	modesOfPayment: ModeOfPaymentDTO[];
	onClose: () => void;
	onConfirm: (payments: PaymentInput[], idempotencyKey: string) => void;
};

function formatAmountInput(value: number) {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function createIdempotencyKey() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CheckoutDialog({
	currency,
	invoice,
	isOpen,
	isSubmitting,
	modesOfPayment,
	onClose,
	onConfirm,
}: CheckoutDialogProps) {
	if (!isOpen) {
		return null;
	}

	return (
		<CheckoutDialogContent
			currency={currency}
			invoice={invoice}
			isSubmitting={isSubmitting}
			modesOfPayment={modesOfPayment}
			onClose={onClose}
			onConfirm={onConfirm}
		/>
	);
}

function CheckoutDialogContent({
	currency,
	invoice,
	isSubmitting,
	modesOfPayment,
	onClose,
	onConfirm,
}: Omit<CheckoutDialogProps, "isOpen">) {
	const total = getInvoiceTotal(invoice);
	const defaultMode = useMemo(
		() => modesOfPayment.find((mode) => mode.default)?.mode_of_payment || modesOfPayment[0]?.mode_of_payment || "",
		[modesOfPayment],
	);
	const [modeOfPayment, setModeOfPayment] = useState(defaultMode);
	const [amount, setAmount] = useState(() => formatAmountInput(total || 0));
	const idempotencyKey = useRef(createIdempotencyKey());
	const selectedModeOfPayment = modeOfPayment || defaultMode;
	const paymentAmount = Number(amount || total || 0);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
			<div className="w-full max-w-md rounded-lg border border-outline-variant bg-surface p-5 shadow-lg">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold text-on-surface">Checkout</h2>
						<p className="text-sm text-on-surface-variant">Select payment mode and submit the invoice.</p>
					</div>
					<button type="button" className="rounded-md p-2 hover:bg-surface-container" onClick={onClose}>
						<X className="size-5" />
					</button>
				</div>
				<div className="mt-5 space-y-4">
					<div className="rounded-md bg-surface-container-low p-4">
						<p className="text-sm text-on-surface-variant">Amount due</p>
						<p className="text-2xl font-semibold text-on-surface">{formatCurrency(total, currency)}</p>
					</div>
					<label className="block text-sm font-medium text-on-surface">
						Payment mode
						<select
							className="mt-2 h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
							value={selectedModeOfPayment}
							onChange={(event) => setModeOfPayment(event.target.value)}
						>
							{modesOfPayment.map((mode) => (
								<option key={mode.mode_of_payment} value={mode.mode_of_payment}>
									{mode.mode_of_payment}
								</option>
							))}
						</select>
					</label>
					<label className="block text-sm font-medium text-on-surface">
						Amount
						<input
							className="mt-2 h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
							inputMode="decimal"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
						/>
					</label>
				</div>
				<div className="mt-6 flex justify-end gap-3">
					<Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
						Cancel
					</Button>
					<Button
						disabled={!selectedModeOfPayment || !paymentAmount || isSubmitting}
						onClick={() =>
							onConfirm(
								[{ mode_of_payment: selectedModeOfPayment, amount: paymentAmount }],
								idempotencyKey.current,
							)
						}
					>
						{isSubmitting ? "Submitting..." : "Submit invoice"}
					</Button>
				</div>
			</div>
		</div>
	);
}
