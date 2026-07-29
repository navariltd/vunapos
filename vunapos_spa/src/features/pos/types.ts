export type ModeOfPaymentDTO = {
	mode_of_payment: string;
	default?: number | boolean ;
	account?: string;
	type?: "Cash" | "Bank" | "General" | "Phone" | string;
	requires_reference?: boolean;
};

export type POSProfileOptionDTO = {
	name: string;
	company?: string;
	warehouse?: string;
	currency?: string;
	modes_of_payment?: ModeOfPaymentDTO[];
};

export type CustomerDTO = {
	customer: string;
	customer_name: string;
	mobile_no?: string | null;
	email_id?: string | null;
	customer_group?: string | null;
	default_price_list?: string | null;
};

export type CustomerLoyaltyDTO = {
	customer: string;
	enrolled: boolean;
	program?: string | null;
	tier?: string | null;
	points: number;
	conversion_factor: number;
	redemption_value: number;
	currency?: string;
};

export type CustomerDirectoryRowDTO = CustomerDTO & {
	customer_type?: string | null;
	customer_group?: string | null;
	territory?: string | null;
	currency?: string | null;
	outstanding_balance?: number | null;
	invoice_count?: number | null;
	last_purchase_date?: string | null;
	loyalty_points?: number | null;
	modified?: string;
};

export type CustomerDirectoryDTO = {
	customers: CustomerDirectoryRowDTO[];
	total_count: number;
	start: number;
	limit: number;
	as_of: string;
	financials_visible: boolean;
	loyalty_visible: boolean;
	customer_groups: string[];
	territories: string[];
};

export type CustomerDetailsDTO = {
	customer: CustomerDirectoryRowDTO & { tax_id?: string | null };
	balance: number;
	loyalty: null | { program?: string | null; points: number; tier?: string | null; conversion_factor?: number };
	invoices: Array<{
		name: string; doctype: string; posting_date: string; due_date?: string | null; currency?: string;
		grand_total: number; paid_amount: number; outstanding_amount: number;
		status: "Paid" | "Partly Paid" | "Unpaid" | "Overdue" | "Credit Note";
		is_return: boolean; return_against?: string | null;
	}>;
	payments: Array<{
		name: string; posting_date: string; mode_of_payment?: string | null; paid_amount: number;
		received_amount: number; unallocated_amount: number; reference_no?: string | null; remarks?: string | null;
	}>;
	contact?: Record<string, string | null> | null;
	address?: Record<string, string | null> | null;
	as_of: string;
};

export type POSSessionDTO = {
	has_opening_entry: boolean;
	opening_entry: string | null;
	opened_at?: string | null;
	verified_at?: string | null;
	cashier?: string;
	pos_profile?: string;
	ready: boolean;
	status?: "OPEN" | "OPENING_REQUIRED" | "CLOSING" | "CLOSING_FAILED";
	closing_entry?: string | null;
};

export type POSClosingPaymentDTO = {
	mode_of_payment: string;
	opening_amount: number;
	expected_amount: number;
	closing_amount: number;
	difference: number;
};

export type POSClosingPreviewDTO = {
	name?: string;
	status?: string;
	opening_entry: string;
	pos_profile: string;
	cashier: string;
	period_start_date: string;
	period_end_date: string;
	invoice_count: number;
	invoices: {
		name: string;
		doctype: string;
		posting_date: string;
		posting_time?: string;
		customer?: string;
		grand_total: number;
		is_return: boolean;
	}[];
	net_total: number;
	total_taxes_and_charges: number;
	grand_total: number;
	total_quantity: number;
	payment_activity?: {
		sales_collected: number;
		outstanding_invoice_payments: number;
		customer_advances: number;
		reconciled_existing_credits: number;
		cash_received: number;
		credit_sales: number;
		credit_outstanding: number;
	};
	payments: POSClosingPaymentDTO[];
	session?: POSSessionDTO;
};


export type BootstrapData = {
	user?: unknown;
	current_user?: string;
	pos_profile?: string;
	company?: string;
	warehouse?: string;
	price_list?: string;
	allow_price_list_switching?: boolean;
	allowed_price_lists?: Array<{ name: string; currency?: string }>;
	currency?: string;
	currency_precision?: number;
	disable_rounded_total?: boolean;
	smallest_currency_fraction_value?: number | null;
	rounding_method?: string;
	allow_partial_payment?: boolean;
	allow_credit_sales?: boolean;
	default_sale_type?: "Cash Sale" | "Credit Sale";
	allow_rate_change?: boolean;
	allow_discount_change?: boolean;
	hide_images?: boolean;
	item_prices_include_tax?: boolean;
	default_customer?: CustomerDTO | string | null;
	modes_of_payment?: ModeOfPaymentDTO[];
	mode_of_payments?: ModeOfPaymentDTO[];
	print_format?: string | null;
	invoice_mode?: "Sales Invoice" | "POS Invoice" | string;
	session?: POSSessionDTO;
};

export type ItemDTO = {
	item_code: string;
	item_name: string;
	modified?: string;
	item_group?: string;
	description?: string;
	image?: string | null;
	stock_uom?: string;
	uoms?: Array<{ uom: string; conversion_factor: number; rate?: number | null }>;
	uom?: string;
	rate?: number;
	price_list_rate?: number;
	pricing_rule?: {
		rate: number;
		discount_percentage: number;
		pricing_rules: string[];
		preview_qty: number;
	};
	actual_qty?: number;
	is_stock_item?: boolean | number;
	allow_negative_stock?: boolean | number;
	has_batch_no?: boolean | number;
	has_serial_no?: boolean | number;
	barcode?: string | null;
	item_tax_template?: string | null;
	item_tax?: {
		template: string;
		tax_rate: number;
		inclusive_tax_rate: number;
		exclusive_tax_rate: number;
		inclusive: boolean;
		net_rate: number;
		tax_amount: number;
		gross_rate: number;
		accounts: Array<{ account_head: string; rate: number; included_in_print_rate: boolean }>;
	};
};

export type BatchAllocationDTO = {
	batch_no: string;
	qty: number;
	expiry_date?: string | null;
	available_qty?: number | null;
};

export type SerialAllocationDTO = { serial_no: string; batch_no?: string | null };

export type PricingOverrideDTO = {
	type: "rate" | "discount_percentage" | "discount_amount";
	value: number;
};

export type ItemBatchDTO = {
	batch_no: string;
	expiry_date?: string | null;
	available_qty?: number | null;
};

export type ItemBatchesDTO = {
	item_code: string;
	warehouse?: string;
	requires_batch?: boolean;
	requires_serial?: boolean;
	batches: ItemBatchDTO[];
	serials?: SerialAllocationDTO[];
	verified_at?: string;
};

export type BatchAllocationResultDTO = {
	item_code: string;
	warehouse?: string;
	requested_qty: number;
	allocated_qty: number;
	strategy?: string;
	requires_batch?: boolean;
	requires_serial?: boolean;
	allocations: BatchAllocationDTO[];
};

export type InvoiceItemDTO = {
	row_name: string;
	item_code: string;
	item_name: string;
	description?: string;
	qty: number;
	uom?: string;
	stock_uom?: string;
	conversion_factor?: number;
	uoms?: Array<{ uom: string; conversion_factor: number; rate?: number | null }>;
	rate: number;
	price_list_rate?: number;
	discount_percentage?: number;
	discount_amount?: number;
	amount: number;
	actual_qty?: number;
	is_stock_item?: boolean | number;
	allow_negative_stock?: boolean | number;
	has_batch_no?: boolean | number;
	has_serial_no?: boolean | number;
	warehouse?: string;
	batch_no?: string | null;
	serial_and_batch_bundle?: string | null;
	batch_allocations?: BatchAllocationDTO[];
	serial_allocations?: SerialAllocationDTO[];
	item_tax_template?: string | null;
	item_tax?: ItemDTO["item_tax"];
	barcode?: string | null;
	item_note?: string | null;
	pricing_rules?: string | null;
	catalogue_pricing_rule?: ItemDTO["pricing_rule"];
	pricing_override_audit?: string | null;
	pricing_override_by?: string | null;
	pricing_override?: PricingOverrideDTO;
};

export type TaxDTO = {
	description?: string;
	account_head?: string;
	charge_type?: string;
	rate?: number;
	tax_amount?: number;
	total?: number;
	included_in_print_rate?: boolean | number;
};

export type InvoiceDTO = {
	doctype: "Sales Invoice" | "POS Invoice" | string;
	name: string;
	docstatus: 0 | 1 | 2;
	is_local?: boolean;
	is_held?: boolean;
	is_credit_sale?: boolean;
	source_invoice_doctype?: string;
	source_invoice_name?: string;
	customer?: string;
	customer_name?: string;
	selling_price_list?: string;
	price_list_currency?: string;
	redeem_loyalty_points?: boolean;
	loyalty_program?: string | null;
	loyalty_points?: number;
	loyalty_amount?: number;
	posting_date?: string;
	due_date?: string;
	modified?: string;
	items: InvoiceItemDTO[];
	taxes?: TaxDTO[];
	payments?: PaymentInput[];
	totals: {
		net_total?: number;
		total_taxes_and_charges?: number;
		grand_total?: number;
		rounded_total?: number;
		paid_amount?: number;
		outstanding_amount?: number;
		change_amount?: number;
	};
};

export type HeldInvoiceDTO = {
	doctype: "Sales Invoice" | "POS Invoice" | string;
	name: string;
	customer?: string;
	customer_name?: string;
	posting_date?: string;
	modified?: string;
	grand_total?: number;
	rounded_total?: number;
	total?: number;
	currency?: string;
};

export type PaymentInput = {
	mode_of_payment: string;
	amount: number;
};

export type PrintPayload = {
	invoice_doctype: string;
	invoice_name: string;
	print_format?: string | null;
	html: string;
};
