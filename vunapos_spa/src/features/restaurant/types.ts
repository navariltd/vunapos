// Mirrors vunapos/dto/restaurant.py and vunapos/services/floor_plan_service.py.
// Positions and sizes are in virtual canvas units (1000 x 700), not pixels.

import type { InvoiceDTO, ItemDTO } from "../pos/types";

export type FloorElementType = "Wall" | "Door" | "Window" | "Bar Counter" | "Plant" | "Label";

export type RestaurantTableShape = "Square" | "Round" | "Rectangle" | "Oval";

export type FloorElementDTO = {
	name?: string;
	element_type: FloorElementType;
	label?: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	color?: string | null;
};

export type RestaurantTableDTO = {
	name: string;
	floor: string;
	table_label: string;
	seats: number;
	shape: RestaurantTableShape;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	is_active: boolean;
};

export type RestaurantFloorDTO = {
	name: string;
	floor_name: string;
	display_order: number;
	is_active: boolean;
	background_color?: string | null;
	background_image?: string | null;
	elements: FloorElementDTO[];
	tables: RestaurantTableDTO[];
};

export type FloorPlanDTO = {
	pos_profile: string;
	pos_mode: "Restaurant";
	canvas: { width: number; height: number };
	// Opaque token; send it back unchanged with save_floor_plan.
	version: string;
	// True for restaurant managers. Their plan also includes inactive rows.
	can_edit: boolean;
	floors: RestaurantFloorDTO[];
};

// Existing rows carry `name`; new rows carry a unique `client_id` instead.
type RowIdentity = { name: string; client_id?: never } | { name?: never; client_id: string };

export type SaveFloorPlanTable = RowIdentity &
	Omit<RestaurantTableDTO, "name" | "floor" | "shape" | "is_active"> & {
		shape?: RestaurantTableShape;
		is_active?: boolean;
	};

export type SaveFloorPlanFloor = RowIdentity &
	Omit<RestaurantFloorDTO, "name" | "is_active" | "tables"> & {
		is_active?: boolean;
		tables: SaveFloorPlanTable[];
	};

// The complete layout. Floors and tables missing from it are deleted.
export type SaveFloorPlanPayload = {
	version: string;
	floors: SaveFloorPlanFloor[];
};

export type SaveFloorPlanResultDTO = {
	plan: FloorPlanDTO;
	// client_id -> name of each row created by the save.
	id_map: {
		floors: Record<string, string>;
		tables: Record<string, string>;
	};
};

// bootstrap.restaurant (null on Retail profiles). The shapes live with the cached
// profile in lib/types; these names match the frontend guide.
export type {
	CachedServiceType as ServiceTypeDTO,
	CachedRestaurantSettings as RestaurantSettingsDTO,
} from "../../lib/types";

// ---- orders (vunapos/dto/restaurant.py, vunapos/services/restaurant_order_service.py) ----

export type MenuDTO = {
	availability_refresh_after?: number | null;
	pricing_context?: {
		tax_rows: import("../../lib/invoiceEngine").TaxTemplateRow[];
		tax_settings: import("../../lib/invoiceEngine").EngineTaxSettings;
		item_prices_include_tax?: boolean;
	};
	available_item_codes?: string[] | null;
	modifier_groups?: Record<string, ModifierGroupDTO[]>;
	pos_profile: string;
	service_type: string | null;
	table: string | null;
	floor: string | null;
	price_list: string;
	restricted: boolean;
	source: "Menu" | "POS Profile Item Groups" | "All Items";
	categories: Array<{ item_group: string; label: string }>;
	items: Array<ItemDTO & { menu_category: string | null }>;
};

export type TableOrderRefDTO = {
	name: string;
	service_type: string;
	pax: number;
	waiter: string;
	waiter_name: string | null;
	opened_at: string;
};

export type TableStatusDTO = {
	session?: RestaurantSessionSummaryDTO | null;
	table: string;
	table_label: string;
	floor: string;
	seats: number;
	// Paid: a kiosk order paid at the counter first, waiting for staff to clear the table.
	// New QR Order: a guest's QR order waiting for staff to accept or reject it.
	status: "Free" | "Occupied" | "Paid" | "New QR Order";
	orders: TableOrderRefDTO[];
};

export type RestaurantOrderLineDTO = {
	modifiers?: Array<{ label: string }>;
	parent_line_id?: string | null;
	line_id: string;
	item_code: string;
	item_name: string;
	qty: number;
	uom: string;
	rate?: number;
	amount?: number;
	note: string | null;
	added_by: string;
	added_at: string;
};

export type RestaurantOrderStatus = "Open" | "Billed" | "Cancelled";

export type RestaurantOrderDTO = {
  can_cancel_items?: boolean;
  cancellations?: Array<{ reason: string; actor: string; occurred_at: string; approved_by?: string | null; items: Array<{ item_name: string; qty: number; uom: string }> }>;
	restaurant?: string | null;
	branch?: string | null;
	restaurant_session?: string | null;
	grand_total?: number;
	name: string;
	status: RestaurantOrderStatus;
	pos_profile: string;
	service_type: string;
	table: string | null;
	table_label: string | null;
	customer: string | null;
	customer_name: string | null;
	pax: number;
	waiter: string;
	waiter_name: string | null;
	opened_at: string;
	order_note: string | null;
	items: RestaurantOrderLineDTO[];
	invoice_doctype: string | null;
	invoice: string | null;
	modified: string;
};

export type RestaurantOrderSummaryDTO = Pick<
	RestaurantOrderDTO,
	| "name"
	| "restaurant_session"
	| "status"
	| "service_type"
	| "table"
	| "table_label"
	| "customer"
	| "pax"
	| "waiter"
	| "waiter_name"
	| "opened_at"
	| "invoice_doctype"
	| "invoice"
	| "modified"
> & {
	preparation_status?: string;
	billing_pending?: boolean;
	kiosk_status?: KioskStatus | null;
	order_source?: OrderSource | null;
	qr_status?: QrOrderStatus | null;
	order_number?: number | null;
	// The session's Sales Orders, so Open Orders finds a visit by either name.
	sales_orders?: string[];
};

// A kiosk order paid at the counter first is a draft, Awaiting Payment, until a cashier
// confirms the payment: that sends it to the kitchen and bills it, and it is then Paid.
// Its table stays taken until staff clear it. "Bill at the end" orders start as Sent to Kitchen.
export type KioskStatus = "Awaiting Payment" | "Paid" | "Sent to Kitchen";

// Where a visit started. A QR order is Pending until staff accept it, which sends it to
// the kitchen, or reject it, which cancels the visit and frees the table.
export type OrderSource = "Waiter" | "Kiosk" | "QR";
export type QrOrderStatus = "Pending" | "Accepted" | "Rejected";

export type RestaurantSessionStatus = "Open" | "Settling" | "Settled" | "Closed - Unpaid" | "Cancelled";

export type RestaurantSessionSummaryDTO = {
  status?: RestaurantSessionStatus;
	preparation_status?: string;
	name: string; customer: string; waiter: string; waiter_name: string | null;
	guest_count: number; opened_at: string; service_type: string; modified: string;
	tables: Array<{ table: string; table_label: string }>;
	kiosk_status?: KioskStatus | null;
	order_source?: OrderSource | null;
	qr_status?: QrOrderStatus | null;
	order_number?: number | null;
	sales_orders?: string[];
};

export type RestaurantSessionDTO = Omit<RestaurantSessionSummaryDTO, "tables"> & {
  billing_doctype?: string | null; billing_invoice?: string | null; billing_profile?: string | null;
	kitchen_tickets?: KitchenTicketSummaryDTO[];
	pos_profile: string; restaurant: string; branch: string; company: string;
	selling_price_list?: string | null; currency?: string | null;
	available_waiters?: Array<{ name: string; full_name: string }>;
	walkout_reason?: string | null; walkout_by?: string | null; walkout_at?: string | null;
	status: RestaurantSessionStatus;
	customer_name: string; tables: Array<{ table: string; table_label: string; released_at: string | null }>;
	rounds: RestaurantOrderDTO[];
	confirmed_by?: string | null;
	accepted_by?: string | null;
};

export type KioskSetupDTO = {
	service_types: import("../../lib/types").CachedServiceType[];
	payment_timing: import("../../lib/types").KioskPaymentTiming;
	floor_plan: FloorPlanDTO;
	// Free, Occupied or Paid only: the kiosk never sees who holds a table.
	tables: TableStatusDTO[];
};

export type QrTablesDTO = {
	// Whether a POS Profile of the branch has QR Table Ordering switched on.
	enabled: boolean;
	qr_profile: string | null;
	floors: Array<{
		name: string;
		floor_name: string;
		tables: Array<{ table: string; table_label: string; has_code: boolean; code_created_at: string | null }>;
	}>;
};

// What a guest's phone knows about the table it scanned: never who holds it.
export type TableOrderSetupDTO = {
	restaurant_name: string;
	table_label: string;
	floor_name: string | null;
	service_type: string;
	currency: string | null;
	state: "available" | "occupied";
};

export type TableOrderResultDTO = { order: string; status: QrOrderStatus };

export type KioskOrderDTO = {
	session: string;
	order_number: number;
	kiosk_status: KioskStatus;
	service_type: string;
	table: string | null;
	table_label: string | null;
	sales_order: string;
	grand_total: number;
	rounded_total: number;
	currency: string;
	print_format: string;
};

export type OrderLineInput = { item_code: string; qty: number; uom?: string; note?: string; line_id: string; modifiers?: Array<{ group: string; option: string }> };

export type ModifierGroupDTO = {
	name: string; label: string; min_selections: number; max_selections: number;
	options: Array<{ name: string; label: string; addon_item?: string | null; addon_qty: number; uom?: string | null; rate: number; item_tax?: ItemDTO["item_tax"]; available: boolean }>;
};
export type SelectedModifier = { group: string; option: string; label: string; extra_rate: number };

export type OrderPreviewDTO = { order: RestaurantOrderDTO; invoice: InvoiceDTO };
export type SessionBillDTO = { session: RestaurantSessionDTO; invoice: InvoiceDTO; fingerprint: string; account_reference: string; gateway_links?: import("../pos/types").GatewayPaymentLinkDTO[]; can_checkout?: boolean; can_record_walkout?: boolean; checkout_block_reason?: string | null; will_complete_preparation?: boolean };
export type SessionSettlementDTO = { session: RestaurantSessionDTO; invoice: InvoiceDTO };

export type KitchenRoutingIssue = {
	items: Array<{ item_code: string; item_group: string; reason: "missing" | "ambiguous" | "invalid"; candidates: string[] }>;
	stations: Array<{ name: string; station_name: string }>;
};

export type KitchenTicketSummaryDTO = {
	name: string; sales_order: string; kitchen_station: string; station_label: string;
	status: string; sent_at: string; server_now?: string; received_at?: number;
	// Billed before the kitchen finished: its stock already moved, and later steps only change the status.
	production_completed_at_billing?: number;
};

export type KitchenTicketDTO = KitchenTicketSummaryDTO & {
	can_print?: boolean;
	can_update_notes?: boolean;
	can_remake?: boolean;
	can_reject?: boolean;
	can_stop_preparation?: boolean;
	can_cancel_remake?: boolean;
	replacement_stock_issues?: Array<{ name: string; docstatus: number }>;
	remake_of?: string | null;
	remake_reason?: string | null;
	original_disposition?: string | null;
	can_record_waste?: boolean;
	modified?: string;
	pos_profile?: string;
	available_actions?: KitchenAction[];
	can_cancel_order?: boolean;
	requires_cancel_pin?: boolean;
	actions?: Array<{ name: string; action: string; outcome: "Succeeded" | "Failed"; from_status: string; to_status: string; actor: string; occurred_at: string; reason?: string; approved_by?: string; error_message?: string; stock_entries?: string; item_quantities?: { deltas: Record<string, number>; journal_entry?: string; invoice?: string; replacement_ticket?: string; disposition?: string; charge?: string; charge_item?: string; materials?: Array<{ id: string; item_name: string; used_qty: number; max_qty: number; uom: string; kind: string }>; stock_entries?: string[] } | null }>;
	restaurant_session: string; table_labels?: string | null; service_type?: string | null;
	sent_by: string; sent_by_name?: string | null; waiter?: string | null; waiter_name?: string | null; order_note?: string | null; note_updated?: boolean;
	items: Array<{ line_id: string; work_order?: string | null; parent_line_id?: string | null; item_code: string; item_name: string;
		qty: number; uom: string; stock_qty: number; stock_uom: string; note?: string | null; note_updated?: boolean;
		modifiers: Array<{ label: string }>; temporary_routing: boolean } & Partial<KitchenLineProgress>>;
};

export type KitchenLineProgress = {
  rejected_qty?: number;
  rejected_served_qty?: number;
  remade_qty?: number;
  retired_qty?: number;
  cancelled_qty?: number;
  accepted_qty: number;
  started_qty: number;
  ready_qty: number;
  served_qty: number;
  not_accepted_qty: number;
  waiting_qty: number;
  preparing_qty: number;
  ready_to_serve_qty: number;
  available_quantities: Partial<Record<KitchenAction, number>>;
};

export type KitchenAction = "Accept" | "Start" | "Ready" | "Serve" | "Undo Serve" | "Cancel Remake";
export type KitchenBoardDTO = {
	server_now?: string;
	can_manage_availability?: boolean;
	stations: Array<{ name: string; station_name: string; enabled: number; ordering_paused?: boolean; availability_reason?: string | null; unavailable_until?: string | null }>;
	tickets: KitchenTicketDTO[];
	has_more: boolean;
	start: number;
};
