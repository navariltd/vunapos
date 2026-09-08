// Mirrors the server DTOs in vunapos/dto/*.py and the bootstrap payload shape
// returned by vunapos.api.pos.get_pos_bootstrap (vunapos/services/sync_service.py).

export type CachedItem = {
	item_code: string;
	item_name: string;
	item_group?: string;
	description?: string | null;
	image?: string | null;
	stock_uom?: string;
	sales_uom?: string | null;
	uom?: string;
	conversion_factor?: number;
	uoms?: Array<{ uom: string; conversion_factor: number; rate?: number | null }>;
	rate?: number | null;
	price_list_rate?: number | null;
	pricing_rule?: {
		rate: number;
		discount_percentage: number;
		pricing_rules: string[];
		preview_qty: number;
		kind?: "price" | "product";
		free_items?: Array<{ item_code: string; item_name?: string; qty: number; uom?: string }>;
	};
	actual_qty?: number | null;
	is_stock_item?: boolean | number;
	allow_negative_stock?: boolean | number;
	has_batch_no?: boolean | number;
	has_serial_no?: boolean | number;
	barcode?: string | null;
	modified: string;
	/** N9: this item's assigned Item Tax Template, if any (vunapos/dto/item.py). */
	item_tax_template?: string | null;
	item_tax?: ItemTaxSummary | null;
};

export type ItemTaxSummary = {
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

export type CachedCustomer = {
	customer: string;
	customer_name: string;
	mobile_no?: string | null;
	email_id?: string | null;
	customer_group?: string | null;
	default_price_list?: string | null;
	is_walkin?: boolean | number;
	tax_id?: string | null;
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
	included_in_print_rate?: boolean;
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
	type?: "Cash" | "Bank" | "General" | "Phone" | string;
	payment_gateway?: string | null;
};

export type CachedProfile = {
	name: string;
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
	auto_allocate_payment_balance?: boolean;
	new_item_position?: "Top" | "Bottom";
	default_sale_type?: "Cash Sale" | "Credit Sale";
	allow_rate_change?: boolean;
	allow_discount_change?: boolean;
	hide_images?: boolean;
	hide_unavailable_items?: boolean;
	automatically_add_filtered_item_to_cart?: boolean;
	ignore_pricing_rule?: boolean;
	item_prices_include_tax?: boolean;
	default_order_type?: "Sales Invoice" | "Sales Order";
	allow_service_items?: boolean;
	allow_delivery_charges?: boolean;
	allow_delivery_charge_change?: boolean;
	delivery_charge_item?: string | null;
	allow_order_type_change?: boolean;
	allow_customer_management?: boolean;
	allow_customer_creation?: boolean;
	allow_customer_payments?: boolean;
	allow_sales_order_payments?: boolean;
	allow_payment_reconciliation?: boolean;
	allow_payment_history?: boolean;
	checkout_fields?: Array<{
		doctype: "Sales Invoice" | "POS Invoice" | "Sales Order";
		fieldname: string;
		label: string;
		fieldtype: string;
		options?: string | null;
		required?: boolean;
		placeholder?: string | null;
		help_text?: string | null;
		order?: number;
	}>;
	default_customer?: unknown;
	modes_of_payment?: CachedPaymentMode[];
	print_format?: string | null;
	invoice_mode?: string;
	background_submission?: {
		enabled: boolean;
		configured?: boolean;
		stock_reservation_enabled?: boolean;
		max_attempts: number;
		processing_timeout_minutes: number;
	};
	enable_salesperson_pin?: boolean;
	require_manager_pin_item_removal?: boolean;
	require_pin_before_every_sale?: boolean;
	pin_max_attempts?: number;
	pin_lockout_minutes?: number;
	salesperson_pin_session_minutes?: number;
	pin_users?: Array<{ sales_person: string; display_name?: string; role: "Salesperson" | "Manager" }>;
	taxes_and_charges?: string | null;
};

export type CachedPosSession = {
	has_opening_entry: boolean;
	opening_entry: string | null;
	opened_at?: string | null;
	verified_at?: string | null;
	cashier: string;
	pos_profile: string;
	ready: boolean;
	status: "OPEN" | "OPENING_REQUIRED" | "CLOSING" | "CLOSING_FAILED";
	closing_entry?: string | null;
};

export type MetaRow = {
	key: string;
	value: unknown;
};

export type BootstrapConfigPayload = {
	server_time: string;
	pos_profile: CachedProfile;
	pos_session: CachedPosSession;
	tax_settings: TaxSettings;
	payment_modes: CachedPaymentMode[];
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
	pos_session: CachedPosSession;
	items: CachedItem[];
	customers: CachedCustomer[];
	tax_templates: CachedTaxTemplate[];
	item_tax_templates: CachedItemTaxTemplate[];
	tax_settings: TaxSettings;
	payment_modes: CachedPaymentMode[];
	deleted?: BootstrapDeleted;
};
