import type { AssembledInvoice } from "./invoiceEngine";

// Client-rendered receipt (ADR-012, N8): Jinja print formats can't run offline, so a
// queued sale gets this instead of the server's. Visual parity is maintained
// manually, not pixel-for-pixel - the goal is a real receipt with zero network, not
// reproducing Frappe's print format engine.

export type LocalReceiptInput = {
	localRef: string;
	assembled: AssembledInvoice;
	customerName?: string | null;
	payments: { mode_of_payment: string; amount: number }[];
	companyName?: string;
	posProfileName?: string;
	currency?: string;
	cashierName?: string;
	postingDate: string;
	postingTime: string;
};

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function money(value: number, currency?: string): string {
	try {
		return new Intl.NumberFormat(undefined, {
			style: currency ? "currency" : "decimal",
			currency: currency || undefined,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(value);
	} catch {
		return value.toFixed(2);
	}
}

export function renderLocalReceipt(input: LocalReceiptInput): string {
	const { assembled, currency } = input;

	const itemRows = assembled.items
		.map(
			(item) => `
			<div class="row">
				<span>${escapeHtml(item.item_code)} &times;${item.qty}</span>
				<span>${money(item.amount, currency)}</span>
			</div>`,
		)
		.join("");

	const taxRows = assembled.taxes
		.map(
			(tax) => `
			<div class="row muted">
				<span>${escapeHtml(tax.description || tax.account_head || "Tax")} (${tax.rate}%)</span>
				<span>${money(tax.tax_amount, currency)}</span>
			</div>`,
		)
		.join("");

	const paymentRows = input.payments
		.map(
			(payment) => `
			<div class="row">
				<span>${escapeHtml(payment.mode_of_payment)}</span>
				<span>${money(payment.amount, currency)}</span>
			</div>`,
		)
		.join("");

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.localRef)}</title>
<style>
	body { font-family: "Courier New", monospace; width: 280px; margin: 0 auto; padding: 12px 8px; font-size: 12px; color: #111; }
	.center { text-align: center; }
	.bold { font-weight: bold; }
	.muted { color: #555; font-size: 11px; }
	.row { display: flex; justify-content: space-between; gap: 8px; }
	hr { border: none; border-top: 1px dashed #999; margin: 6px 0; }
	.notice { border: 1px solid #111; padding: 4px; margin-top: 8px; text-align: center; font-size: 11px; }
</style>
</head>
<body>
	<div class="center bold">${escapeHtml(input.companyName || "")}</div>
	${input.posProfileName ? `<div class="center muted">${escapeHtml(input.posProfileName)}</div>` : ""}
	<hr />
	<div>Receipt: ${escapeHtml(input.localRef)}</div>
	<div>Date: ${escapeHtml(input.postingDate)} ${escapeHtml(input.postingTime)}</div>
	${input.cashierName ? `<div>Cashier: ${escapeHtml(input.cashierName)}</div>` : ""}
	<div>Customer: ${escapeHtml(input.customerName || "Walk-in")}</div>
	<hr />
	${itemRows}
	<hr />
	<div class="row"><span>Subtotal</span><span>${money(assembled.totals.net_total, currency)}</span></div>
	${taxRows}
	<div class="row"><span>Tax</span><span>${money(assembled.totals.total_taxes_and_charges, currency)}</span></div>
	<div class="row bold"><span>Total</span><span>${money(assembled.totals.grand_total, currency)}</span></div>
	<hr />
	${paymentRows}
	<div class="notice">
		QUEUED &mdash; PENDING SYNC<br />
		This receipt will be confirmed under a permanent invoice number once this device reconnects.
	</div>
</body>
</html>`;
}
