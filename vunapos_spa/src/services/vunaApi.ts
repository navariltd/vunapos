import type {
	BatchAllocationResultDTO,
	BootstrapData,
	CustomerDTO,
	CustomerDirectoryDTO,
	CustomerDetailsDTO,
	HeldInvoiceDTO,
	ItemBatchesDTO,
	InvoiceDTO,
	ItemDTO,
	PaymentInput,
	POSClosingPreviewDTO,
	PrintPayload,
} from "../features/pos/types";

type VunaError = {
	code?: string;
	message: string;
	field?: string;
};

type VunaEnvelope<T> = {
	ok: boolean;
	data: T;
	warnings?: unknown[];
	errors?: VunaError[];
	meta?: Record<string, unknown>;
};

export type FrappeCall<T = unknown> = (params: Record<string, unknown>) => Promise<T>;

export class VunaApiError extends Error {
	code?: string;
	field?: string;

	constructor(message: string, code?: string, field?: string) {
		super(message);
		this.name = "VunaApiError";
		this.code = code;
		this.field = field;
	}
}

export const vunaMethods = {
	getBootstrapData: "vunapos.api.profile.get_bootstrap_data",
	searchItems: "vunapos.api.item.search_items",
	getItemDetails: "vunapos.api.item.get_item_details",
	getItemBatches: "vunapos.api.batch.get_item_batches",
	allocateBatches: "vunapos.api.batch.allocate_batches",
	searchCustomers: "vunapos.api.customer.search_customers",
	getCustomerDirectory: "vunapos.api.customer.get_customer_directory",
	getCustomerDetails: "vunapos.api.customer.get_customer_details",
	receiveCustomerPayment: "vunapos.api.payment.receive_customer_payment",
	getReconciliationCandidates: "vunapos.api.payment.get_reconciliation_candidates",
	getPaymentHistory: "vunapos.api.payment.get_payment_history",
	renderPaymentReceipt: "vunapos.api.payment.render_payment_receipt",
	allocateCustomerPayments: "vunapos.api.payment.allocate_customer_payments",
	reconcileCustomerPayment: "vunapos.api.payment.reconcile_customer_payment",
	createCustomer: "vunapos.api.customer.create_customer",
	createInvoice: "vunapos.api.sales.create_invoice",
	previewInvoice: "vunapos.api.sales.preview_invoice",
	getInvoice: "vunapos.api.sales.get_invoice",
	getInvoiceHistory: "vunapos.api.sales.get_invoice_history",
	getInvoiceDetails: "vunapos.api.sales.get_invoice_details",
	getReturnPreview: "vunapos.api.sales.get_return_preview",
	createInvoiceReturn: "vunapos.api.sales.create_invoice_return",
	addItem: "vunapos.api.sales.add_item",
	updateItem: "vunapos.api.sales.update_item",
	removeItem: "vunapos.api.sales.remove_item",
	submitInvoice: "vunapos.api.sales.submit_invoice",
	checkoutInvoice: "vunapos.api.sales.checkout_invoice",
	createAndSubmitInvoice: "vunapos.api.sales.create_and_submit_invoice",
	createInvoiceFromCart: "vunapos.api.sales.create_invoice_from_cart",
	holdInvoice: "vunapos.api.sales.hold_invoice",
	listHeldInvoices: "vunapos.api.sales.list_held_invoices",
	restoreInvoice: "vunapos.api.sales.restore_invoice",
	clearInvoice: "vunapos.api.sales.clear_invoice",
	updateInvoiceFromCart: "vunapos.api.sales.update_invoice_from_cart",
	renderInvoice: "vunapos.api.print.render_invoice",
	getCsrfToken: "vunapos.api.auth.get_csrf_token",
	getClosingPreview: "vunapos.api.pos_closing.get_preview",
	closePosSession: "vunapos.api.pos_closing.close_session",
} as const;

export function unwrapVunaResponse<T>(response: unknown): T {
	const payload = getResponsePayload<T>(response);

	if (payload && typeof payload === "object" && "ok" in payload) {
		const envelope = payload as VunaEnvelope<T>;
		if (envelope.ok) {
			return envelope.data;
		}
		const error = envelope.errors?.[0];
		throw new VunaApiError(
			error?.message || error?.code || "VunaPOS request failed",
			error?.code,
			error?.field,
		);
	}

	return payload as T;
}

function getResponsePayload<T>(response: unknown): T | VunaEnvelope<T> {
	if (response && typeof response === "object" && "message" in response) {
		return (response as { message: T | VunaEnvelope<T> }).message;
	}
	return response as T | VunaEnvelope<T>;
}

async function callAndUnwrap<T>(call: FrappeCall, params: Record<string, unknown>) {
	return unwrapVunaResponse<T>(await call(params));
}

export function getBootstrapData(call: FrappeCall, posProfile?: string) {
	return callAndUnwrap<BootstrapData>(call, { pos_profile: posProfile });
}

export function getClosingPreview(call: FrappeCall, posProfile: string) {
	return callAndUnwrap<POSClosingPreviewDTO>(call, { pos_profile: posProfile });
}

export function closePosSession(
	call: FrappeCall,
	params: { pos_profile: string; closing_balances: { mode_of_payment: string; closing_amount: number }[] },
) {
	return callAndUnwrap<POSClosingPreviewDTO>(call, params);
}

export function searchItems(
	call: FrappeCall,
	params: { query?: string; pos_profile?: string; customer?: string; limit?: number },
) {
	return callAndUnwrap<ItemDTO[]>(call, params);
}

export function getItemDetails(
	call: FrappeCall,
	params: { item_code: string; pos_profile?: string; customer?: string },
) {
	return callAndUnwrap<ItemDTO>(call, params);
}

export function getItemBatches(
	call: FrappeCall,
	params: { item_code: string; warehouse?: string; pos_profile?: string },
) {
	return callAndUnwrap<ItemBatchesDTO>(call, params);
}

export function allocateBatches(
	call: FrappeCall,
	params: {
		item_code: string;
		qty: number;
		warehouse?: string;
		pos_profile?: string;
		strategy?: "FEFO" | string;
	},
) {
	return callAndUnwrap<BatchAllocationResultDTO>(call, params);
}

export function searchCustomers(call: FrappeCall, params: { query?: string; limit?: number }) {
	return callAndUnwrap<CustomerDTO[]>(call, params);
}

export function getCustomerDirectory(call: FrappeCall, params: {
	pos_profile?: string;
	query?: string;
	customer_group?: string;
	customer_type?: string;
	territory?: string;
	start?: number;
	limit?: number;
}) {
	return callAndUnwrap<CustomerDirectoryDTO>(call, params);
}

export function getCustomerDetails(call: FrappeCall, params: { pos_profile?: string; customer: string }) {
	return callAndUnwrap<CustomerDetailsDTO>(call, params);
}

export function createCustomer(
	call: FrappeCall,
	params: { customer_name: string; mobile_no?: string; email_id?: string },
) {
	return callAndUnwrap<CustomerDTO>(call, params);
}

export function createInvoice(call: FrappeCall, params: { pos_profile?: string; customer?: string }) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function previewInvoice(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		customer?: string;
		items: { item_code: string; qty: number; item_tax_template?: string; batch_allocations?: Array<{ batch_no: string; qty: number }>; pricing_override?: { type: string; value: number } }[];
		invoice_doctype?: string;
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		items: JSON.stringify(params.items),
	});
}

export function getInvoice(call: FrappeCall, params: { invoice_doctype: string; invoice_name: string }) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function addItem(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string; item_code: string; qty?: number },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function updateItem(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string; row_name: string; qty: number },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function removeItem(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string; row_name: string },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function submitInvoice(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string; payments?: PaymentInput[] },
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		payments: JSON.stringify(params.payments || []),
	});
}

export function checkoutInvoice(
	call: FrappeCall,
	params: {
		invoice_doctype: string;
		invoice_name: string;
		payments?: PaymentInput[];
		idempotency_key?: string;
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		payments: JSON.stringify(params.payments || []),
	});
}

export function createAndSubmitInvoice(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		customer?: string;
		items: { item_code: string; qty: number; batch_allocations?: Array<{ batch_no: string; qty: number }>; pricing_override?: { type: string; value: number } }[];
		payments?: PaymentInput[];
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		items: JSON.stringify(params.items),
		payments: JSON.stringify(params.payments || []),
	});
}

export function createInvoiceFromCart(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		customer?: string;
		items: { item_code: string; qty: number; batch_allocations?: Array<{ batch_no: string; qty: number }>; pricing_override?: { type: string; value: number } }[];
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		items: JSON.stringify(params.items),
	});
}

export function holdInvoice(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function listHeldInvoices(
	call: FrappeCall,
	params: { pos_profile?: string; limit?: number },
) {
	return callAndUnwrap<HeldInvoiceDTO[]>(call, params);
}

export function restoreInvoice(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function clearInvoice(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function updateInvoiceFromCart(
	call: FrappeCall,
	params: {
		invoice_doctype: string;
		invoice_name: string;
		customer?: string;
		items: { item_code: string; qty: number; batch_allocations?: Array<{ batch_no: string; qty: number }>; pricing_override?: { type: string; value: number } }[];
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		items: JSON.stringify(params.items),
	});
}

export function renderInvoice(
	call: FrappeCall,
	params: { invoice_doctype: string; invoice_name: string; print_format?: string },
) {
	return callAndUnwrap<PrintPayload>(call, params);
}
