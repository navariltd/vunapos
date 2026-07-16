// Mirrors the server DTOs in vunapos/dto/*.py and the bootstrap payload shape
// returned by vunapos.api.pos.get_pos_bootstrap (vunapos/services/sync_service.py).

export type CachedItem = {
	item_code: string;
	item_name: string;
	description?: string | null;
	image?: string | null;
	stock_uom?: string;
	rate?: number | null;
	actual_qty?: number | null;
	is_stock_item?: boolean | number;
	allow_negative_stock?: boolean | number;
	barcode?: string | null;
	modified: string;
	/** N9: this item's assigned Item Tax Template, if any (vunapos/dto/item.py). */
	item_tax_template?: string | null;
};

export type CachedCustomer = {
	customer: string;
	customer_name: string;
	mobile_no?: string | null;
	email_id?: string | null;
	customer_group?: string | null;
	default_price_list?: string | null;
	modified: string;
};

export type TaxRow = {
	account_head?: string;
	charge_type?: string;
	rate?: number;
	included_in_print_rate?: boolean;
	description?: string;
};

export type CachedTaxTemplate = {
	name: string;
	title?: string;
	company?: string;
	is_default?: boolean;
	disabled?: boolean;
	modified: string;
	taxes: TaxRow[];
};

// Item Tax Template Detail has no charge_type/included_in_print_rate (confirmed
// against the doctype's own fields) - it is always a flat percentage on that
// item's own amount, never a cart-wide uniform rate (N9).
export type ItemTaxRow = {
	account_head: string;
	rate: number;
};

export type CachedItemTaxTemplate = {
	name: string;
	title?: string;
	company?: string;
	disabled?: boolean;
	modified: string;
	taxes: ItemTaxRow[];
};

// vunapos.api.pos endpoints read Accounts Settings, not a template's mere
// existence, to decide which tax mechanism(s) are actually live (N9).
export type TaxSettings = {
	add_taxes_from_item_tax_template: boolean;
	add_taxes_from_taxes_and_charges_template: boolean;
};

export type CachedPaymentMode = {
	mode_of_payment: string;
	default?: boolean;
};

export type CachedProfile = {
	name: string;
	company?: string;
	warehouse?: string;
	price_list?: string;
	currency?: string;
	default_customer?: unknown;
	modes_of_payment?: CachedPaymentMode[];
	print_format?: string | null;
	invoice_mode?: string;
	taxes_and_charges?: string | null;
};

export type MetaRow = {
	key: string;
	value: unknown;
};

export type BootstrapDeleted = {
	Item?: string[];
	Customer?: string[];
};

export type BootstrapPayload = {
	server_time: string;
	bootstrap_version: number;
	mode: "full" | "delta";
	pos_profile: CachedProfile;
	items: CachedItem[];
	customers: CachedCustomer[];
	tax_templates: CachedTaxTemplate[];
	item_tax_templates: CachedItemTaxTemplate[];
	tax_settings: TaxSettings;
	payment_modes: CachedPaymentMode[];
	deleted?: BootstrapDeleted;
};

// ── Synchronization (Section 6.2 / 8.2 of the spec) ──

export type QueueStatus = "pending" | "syncing" | "succeeded" | "error" | "archived";

export type QueueAttempt = {
	at: string;
	outcome: "network_error" | "server_error" | "totals_variance" | "rejected" | "success";
	detail?: string;
};

export type InvoicePayload = {
	invoice_doctype?: string;
	pos_profile?: string;
	customer?: string;
	items: { item_code: string; qty: number }[];
	payments: { mode_of_payment: string; amount: number }[];
	posting_date?: string;
	posting_time?: string;
	totals?: {
		net_total?: number;
		total_taxes_and_charges?: number;
		grand_total?: number;
		rounded_total?: number;
	};
	/** Device-generated reference (e.g. "POS-XXXX-00001"), stored server-side on
	 * vunapos_invoice_number_offline so a synced invoice can be traced back to the
	 * offline sale that created it. */
	local_ref: string;
};

// A hold has no payments yet and no "sale moment" (posting_date/time) - that's set
// later at whichever checkout eventually submits it. totals is kept so the server
// can still verify it (_verify_totals_or_park), same defense-in-depth as a sale.
export type HoldPayload = {
	invoice_doctype?: string;
	pos_profile?: string;
	customer?: string;
	items: { item_code: string; qty: number }[];
	totals?: {
		net_total?: number;
		total_taxes_and_charges?: number;
		grand_total?: number;
		rounded_total?: number;
	};
	local_ref: string;
};

type QueueEntryCommon = {
	local_id: string;
	local_ref: string;
	idempotency_key: string;
	schema_version: 1;
	group: string | null;
	status: QueueStatus;
	next_retry_at: string | null;
	created_at: string;
	attempts: QueueAttempt[];
};

export type QueueEntry =
	| (QueueEntryCommon & { type: "create_invoice"; payload: InvoicePayload })
	| (QueueEntryCommon & { type: "hold_invoice"; payload: HoldPayload });

export type QueueMapping = {
	local_id: string;
	server_name: string;
};
