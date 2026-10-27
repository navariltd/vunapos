// Mirrors vunapos/dto/restaurant.py and vunapos/services/floor_plan_service.py.
// Positions and sizes are in virtual canvas units (1000 x 700), not pixels.

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
	color?: string | null;
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
