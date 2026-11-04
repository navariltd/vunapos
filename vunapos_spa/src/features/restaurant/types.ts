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
	status: "Free" | "Occupied";
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
>;

export type RestaurantSessionSummaryDTO = {
	name: string; customer: string; waiter: string; waiter_name: string | null;
	guest_count: number; opened_at: string; service_type: string; modified: string;
	tables: Array<{ table: string; table_label: string }>;
};

export type RestaurantSessionDTO = Omit<RestaurantSessionSummaryDTO, "tables"> & {
	pos_profile: string; restaurant: string; branch: string; company: string;
	selling_price_list?: string | null; currency?: string | null;
	available_waiters?: Array<{ name: string; full_name: string }>;
	status: "Open" | "Settling" | "Settled" | "Closed - Unpaid" | "Cancelled";
	customer_name: string; tables: Array<{ table: string; table_label: string; released_at: string | null }>;
	rounds: RestaurantOrderDTO[];
};

export type OrderLineInput = { item_code: string; qty: number; uom?: string; note?: string; line_id: string; modifiers?: Array<{ group: string; option: string }> };

export type ModifierGroupDTO = {
	name: string; label: string; min_selections: number; max_selections: number;
	options: Array<{ name: string; label: string; addon_item?: string | null; addon_qty: number; uom?: string | null; rate: number; available: boolean }>;
};
export type SelectedModifier = { group: string; option: string; label: string; extra_rate: number };

export type OrderPreviewDTO = { order: RestaurantOrderDTO; invoice: InvoiceDTO };
