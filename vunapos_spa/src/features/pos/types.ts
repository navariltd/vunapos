export type ModeOfPaymentDTO = {
	mode_of_payment: string;
	default?: boolean;
	account?: string;
};

export type CustomerDTO = {
	customer: string;
	customer_name: string;
	mobile_no?: string | null;
	email_id?: string | null;
};

export type BootstrapData = {
	user?: unknown;
	current_user?: string;
	pos_profile?: string;
	company?: string;
	warehouse?: string;
	price_list?: string;
	currency?: string;
	default_customer?: CustomerDTO | string | null;
	modes_of_payment?: ModeOfPaymentDTO[];
	mode_of_payments?: ModeOfPaymentDTO[];
	print_format?: string | null;
	invoice_mode?: "Sales Invoice" | "POS Invoice" | string;
};

export type ItemDTO = {
	item_code: string;
	item_name: string;
	description?: string;
	image?: string | null;
	stock_uom?: string;
	uom?: string;
	rate?: number;
	actual_qty?: number;
	is_stock_item?: boolean | number;
	allow_negative_stock?: boolean | number;
	barcode?: string | null;
};

export type BatchAllocationDTO = {
	batch_no: string;
	qty: number;
	expiry_date?: string | null;
	available_qty?: number | null;
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
	rate: number;
	amount: number;
	actual_qty?: number;
	is_stock_item?: boolean | number;
	allow_negative_stock?: boolean | number;
	batch_no?: string | null;
	serial_and_batch_bundle?: string | null;
	batch_allocations?: BatchAllocationDTO[];
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
	source_invoice_doctype?: string;
	source_invoice_name?: string;
	customer?: string;
	customer_name?: string;
	posting_date?: string;
	modified?: string;
	items: InvoiceItemDTO[];
	taxes?: TaxDTO[];
	payments?: unknown[];
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
