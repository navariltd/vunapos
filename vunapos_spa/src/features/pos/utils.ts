import type { BootstrapData, CustomerDTO, InvoiceDTO } from "./types";

export function formatCurrency(value?: number | null, currency?: string, precision = 2) {
	const amount = Number(value || 0);
	try {
		return new Intl.NumberFormat(undefined, {
			style: currency ? "currency" : "decimal",
			currency: currency || undefined,
			minimumFractionDigits: precision,
			maximumFractionDigits: precision,
		}).format(amount);
	} catch {
		return amount.toFixed(precision);
	}
}

export function getInvoiceTotal(invoice?: InvoiceDTO | null) {
	return invoice?.totals?.rounded_total || invoice?.totals?.grand_total || 0;
}

export function normalizeDefaultCustomer(bootstrap?: BootstrapData | null): CustomerDTO | null {
	const customer = bootstrap?.default_customer;
	if (!customer) {
		return null;
	}
	if (typeof customer === "string") {
		return {
			customer,
			customer_name: customer,
		};
	}
	return customer;
}

export function getPaymentModes(bootstrap?: BootstrapData | null) {
	return bootstrap?.modes_of_payment || bootstrap?.mode_of_payments || [];
}
