import type {
	BatchAllocationResultDTO,
	BootstrapData,
	C2BGatewayPaymentDTO,
	CustomerContactPhoneDTO,
	CustomerAddressDTO,
	CustomerDTO,
	CustomerDirectoryDTO,
	CustomerDetailsDTO,
	CustomerLoyaltyDTO,
	GatewayPaymentLinkDTO,
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
	getPosProfilesForUser: "vunapos.api.profile.get_pos_profiles_for_user",
	searchItems: "vunapos.api.item.search_items",
	resolveBarcode: "vunapos.api.item.resolve_barcode",
	getItemDetails: "vunapos.api.item.get_item_details",
	getProductBundle: "vunapos.api.item.get_product_bundle",
	getTemplateVariants: "vunapos.api.item.get_template_variants",
	getItemBatches: "vunapos.api.batch.get_item_batches",
	allocateBatches: "vunapos.api.batch.allocate_batches",
	searchCustomers: "vunapos.api.customer.search_customers",
	getCustomerDirectory: "vunapos.api.customer.get_customer_directory",
	getCustomerDetails: "vunapos.api.customer.get_customer_details",
	getCustomerContactPhone: "vunapos.api.customer.get_customer_contact_phone",
	getCustomerLoyalty: "vunapos.api.customer.get_customer_loyalty",
	receiveCustomerPayment: "vunapos.api.payment.receive_customer_payment",
	getReconciliationCandidates: "vunapos.api.payment.get_reconciliation_candidates",
	getPaymentHistory: "vunapos.api.payment.get_payment_history",
	renderPaymentReceipt: "vunapos.api.payment.render_payment_receipt",
	allocateCustomerPayments: "vunapos.api.payment.allocate_customer_payments",
	reconcileCustomerPayment: "vunapos.api.payment.reconcile_customer_payment",
	initiateStkGatewayPayment: "vunapos.api.gateway.initiate_stk_gateway_payment",
	getGatewayPaymentStatus: "vunapos.api.gateway.get_gateway_payment_status",
	cancelGatewayPaymentLink: "vunapos.api.gateway.cancel_gateway_payment_link",
	attachC2bGatewayPayment: "vunapos.api.gateway.attach_c2b_gateway_payment",
	searchC2bGatewayPayments: "vunapos.api.gateway.search_c2b_gateway_payments",
	createCustomer: "vunapos.api.customer.create_customer",
	createInvoice: "vunapos.api.sales.create_invoice",
	previewInvoice: "vunapos.api.sales.preview_invoice",
	getInvoice: "vunapos.api.sales.get_invoice",
	getInvoiceHistory: "vunapos.api.sales.get_invoice_history",
	getCheckoutQueue: "vunapos.api.sales.get_checkout_queue",
	retryQueuedInvoice: "vunapos.api.sales.retry_queued_invoice",
	getInvoiceDetails: "vunapos.api.sales.get_invoice_details",
	getReturnPreview: "vunapos.api.sales.get_return_preview",
	createInvoiceReturn: "vunapos.api.sales.create_invoice_return",
	addItem: "vunapos.api.sales.add_item",
	updateItem: "vunapos.api.sales.update_item",
	removeItem: "vunapos.api.sales.remove_item",
	submitInvoice: "vunapos.api.sales.submit_invoice",
	checkoutInvoice: "vunapos.api.sales.checkout_invoice",
	createAndSubmitInvoice: "vunapos.api.sales.create_and_submit_invoice",
	createAndSubmitSalesOrder: "vunapos.api.sales.create_and_submit_sales_order",
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
	verifySalespersonPin: "vunapos.api.pin.verify_salesperson",
	refreshSalespersonPin: "vunapos.api.pin.refresh_salesperson",
	verifyManagerPin: "vunapos.api.pin.verify_manager",
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

export function verifySalespersonPin(
	call: FrappeCall,
	params: { pos_profile: string; salesperson: string; pin: string },
) {
	return callAndUnwrap<{ token: string; salesperson: string; display_name: string; expires_in: number }>(
		call,
		params,
	);
}

export function refreshSalespersonPin(call: FrappeCall, params: { pos_profile: string; token: string }) {
	return callAndUnwrap<{ token: string; salesperson: string; display_name: string; expires_in: number }>(
		call,
		params,
	);
}

export function verifyManagerPin(
	call: FrappeCall,
	params: { pos_profile: string; pin: string; action?: string },
) {
	return callAndUnwrap<{ token: string; manager: string; display_name: string; expires_in: number }>(call, params);
}

export function searchItems(
	call: FrappeCall,
	params: { query?: string; pos_profile?: string; customer?: string; price_list?: string; limit?: number },
) {
	return callAndUnwrap<ItemDTO[]>(call, params);
}

export function resolveBarcode(
	call: FrappeCall,
	params: { barcode: string; pos_profile?: string; customer?: string; price_list?: string },
) {
	return callAndUnwrap<ItemDTO>(call, params);
}

export function getItemDetails(
	call: FrappeCall,
	params: { item_code: string; pos_profile?: string; customer?: string; price_list?: string },
) {
	return callAndUnwrap<ItemDTO>(call, params);
}

export function getProductBundle(
	call: FrappeCall,
	params: { item_code: string; pos_profile?: string; customer?: string; price_list?: string },
) {
	return callAndUnwrap<{
		item_code: string;
		price_list?: string;
		warehouse?: string;
		available_qty?: number | null;
		items: NonNullable<ItemDTO["bundle_items"]>;
	}>(call, params);
}

export function getTemplateVariants(
	call: FrappeCall,
	params: { template_item_code: string; pos_profile?: string; customer?: string; price_list?: string },
) {
	return callAndUnwrap<{
		template: Pick<ItemDTO, "item_code" | "item_name" | "description" | "variant_based_on">;
		variants: Array<ItemDTO & { attributes: Array<{ attribute: string; value: string }> }>;
	}>(call, params);
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

export function getCustomerContactPhone(
	call: FrappeCall,
	params: { pos_profile?: string; customer: string },
) {
	return callAndUnwrap<CustomerContactPhoneDTO>(call, params);
}

export function getCustomerAddresses(
	call: FrappeCall,
	params: { pos_profile?: string; customer: string; limit?: number },
) {
	return callAndUnwrap<CustomerAddressDTO[]>(call, params);
}

export function getCustomerLoyalty(call: FrappeCall, params: { pos_profile?: string; customer: string }) {
	return callAndUnwrap<CustomerLoyaltyDTO>(call, params);
}

export function createCustomer(
	call: FrappeCall,
	params: { customer_name: string; mobile_no?: string; email_id?: string; pos_profile?: string },
) {
	return callAndUnwrap<CustomerDTO>(call, params);
}

export function initiateStkGatewayPayment(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		mode_of_payment: string;
		amount: number;
		phone_number: string;
		customer?: string;
		currency?: string;
		idempotency_key?: string;
		account_reference?: string;
	},
) {
	return callAndUnwrap<GatewayPaymentLinkDTO>(call, params);
}

export function getGatewayPaymentStatus(call: FrappeCall, gatewayPaymentLink: string) {
	return callAndUnwrap<GatewayPaymentLinkDTO>(call, { gateway_payment_link: gatewayPaymentLink });
}

export function cancelGatewayPaymentLink(call: FrappeCall, gatewayPaymentLink: string) {
	return callAndUnwrap<GatewayPaymentLinkDTO>(call, { gateway_payment_link: gatewayPaymentLink });
}

export function attachC2bGatewayPayment(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		mode_of_payment: string;
		transaction_reference: string;
		amount: number;
		customer?: string;
		currency?: string;
		idempotency_key?: string;
	},
) {
	return callAndUnwrap<GatewayPaymentLinkDTO>(call, params);
}

export function searchC2bGatewayPayments(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		mode_of_payment: string;
		query: string;
		customer?: string;
		currency?: string;
		limit?: number;
	},
) {
	return callAndUnwrap<C2BGatewayPaymentDTO[]>(call, params);
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
		price_list?: string;
		loyalty_points?: number;
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
	params: { invoice_doctype: string; invoice_name: string; row_name: string; manager_pin_token?: string },
) {
	return callAndUnwrap<InvoiceDTO>(call, params);
}

export function submitInvoice(
	call: FrappeCall,
	params: {
		invoice_doctype: string;
		invoice_name: string;
		payments?: PaymentInput[];
		is_credit_sale?: boolean;
		due_date?: string;
		loyalty_points?: number;
		tax_id?: string;
		salesperson?: string;
		salesperson_token?: string;
	},
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
		is_credit_sale?: boolean;
		due_date?: string;
		loyalty_points?: number;
		tax_id?: string;
		salesperson?: string;
		salesperson_token?: string;
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		payments: JSON.stringify(params.payments || []),
	});
}

type CartItemInput = {
	item_code: string;
	qty: number;
	uom?: string;
	conversion_factor?: number;
	batch_allocations?: Array<{ batch_no: string; qty: number }>;
	serial_allocations?: Array<{ serial_no: string; batch_no?: string | null }>;
	item_note?: string | null;
	pricing_override?: { type: string; value: number };
};

export function createAndSubmitInvoice(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		customer?: string;
		price_list?: string;
		loyalty_points?: number;
		items: CartItemInput[];
		payments?: PaymentInput[];
		idempotency_key?: string;
		is_credit_sale?: boolean;
		due_date?: string;
		tax_id?: string;
		salesperson?: string;
		salesperson_token?: string;
	},
) {
	return callAndUnwrap<InvoiceDTO>(call, {
		...params,
		items: JSON.stringify(params.items),
		payments: JSON.stringify(params.payments || []),
	});
}

export function createAndSubmitSalesOrder(
	call: FrappeCall,
	params: {
		pos_profile?: string;
		customer?: string;
		price_list?: string;
		items: CartItemInput[];
		idempotency_key?: string;
		delivery_date?: string;
		tax_id?: string;
		salesperson?: string;
		salesperson_token?: string;
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
		price_list?: string;
		loyalty_points?: number;
		items: CartItemInput[];
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
		price_list?: string;
		loyalty_points?: number;
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
