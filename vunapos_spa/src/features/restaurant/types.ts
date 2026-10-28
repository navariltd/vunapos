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
	pos_profile: string;
	service_type: string | null;
	table: string | null;
	floor: string | null;
	price_list: string;
	restricted: boolean;
	source: "Menu" | "POS Profile Item Groups" | "All Items";
	categories: Array<{ item_group: string; label: string }>;
	// Floors named in items' allowed_floors, for their tags.
	floors: Array<{ floor: string; floor_name: string }>;
	items: MenuItemDTO[];
};

// Without a table, a menu spans every floor (and without a service type, every
// type); null means the item is served everywhere.
export type MenuItemDTO = ItemDTO & {
	menu_category: string | null;
	allowed_floors: string[] | null;
	allowed_service_types: string[] | null;
};

export type TableOrderRefDTO = {
	name: string;
	service_type: string;
	pax: number;
	waiter: string;
	waiter_name: string | null;
	opened_at: string;
	// Total quantity on the order's lines.
	item_count: number;
};

export type TableStatusDTO = {
	table: string;
	table_label: string;
	floor: string;
	seats: number;
	status: "Free" | "Occupied";
	orders: TableOrderRefDTO[];
};

export type RestaurantOrderLineDTO = {
	line_id: string;
	item_code: string;
	item_name: string;
	qty: number;
	uom: string;
	note: string | null;
	added_by: string;
	added_at: string;
};

export type RestaurantOrderStatus = "Open" | "Billed" | "Cancelled";

export type RestaurantOrderDTO = {
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

export type OrderLineInput = { item_code: string; qty: number; uom?: string; note?: string; line_id: string };

export type OrderPreviewDTO = { order: RestaurantOrderDTO; invoice: InvoiceDTO };
