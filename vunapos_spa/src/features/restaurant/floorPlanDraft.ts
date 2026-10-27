// Pure editing model for the floor editor: no React, DOM, network or store access.
// A draft mirrors the saved layout, with a stable `key` on every row so the UI can
// track rows that have not been saved yet.

import { CANVAS_HEIGHT, CANVAS_WIDTH, clampBox, normalizeRotation } from "./floorPlanGeometry";
import type {
	FloorElementType,
	FloorPlanDTO,
	RestaurantTableShape,
	SaveFloorPlanFloor,
	SaveFloorPlanPayload,
	SaveFloorPlanResultDTO,
	SaveFloorPlanTable,
} from "./types";

export type DraftElement = {
	key: string;
	element_type: FloorElementType;
	label: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	color: string | null;
};

export type DraftTable = {
	key: string;
	// Saved tables keep their server name; new ones are identified by `key` alone.
	name?: string;
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

export type DraftFloor = {
	key: string;
	name?: string;
	floor_name: string;
	is_active: boolean;
	background_color: string | null;
	background_image: string | null;
	elements: DraftElement[];
	tables: DraftTable[];
};

export type FloorPlanDraft = {
	floors: DraftFloor[];
	// Source of new client ids, kept in the draft so every edit stays pure.
	nextId: number;
};

export type Selection = { kind: "table" | "element"; floorKey: string; key: string } | null;

export type ItemPatch = Partial<Omit<DraftTable, "key" | "name">> & Partial<Omit<DraftElement, "key">>;

export const ELEMENT_DEFAULTS: Record<FloorElementType, { width: number; height: number; label: string | null }> = {
	Wall: { width: 200, height: 20, label: null },
	Door: { width: 80, height: 20, label: null },
	Window: { width: 120, height: 12, label: null },
	"Bar Counter": { width: 240, height: 60, label: "Bar" },
	Plant: { width: 40, height: 40, label: null },
	Label: { width: 140, height: 40, label: "Label" },
};

const TABLE_DEFAULT = { width: 80, height: 80, seats: 4, shape: "Square" as RestaurantTableShape };
const DUPLICATE_OFFSET = 20;
const NEW_ITEM_STEP = 30;

function labelKey(value: string) {
	return value.trim().toLocaleLowerCase();
}

// ---- loading ----

export function toDraft(plan: Pick<FloorPlanDTO, "floors">): FloorPlanDraft {
	let nextId = 1;
	return {
		floors: plan.floors.map((floor) => ({
			key: floor.name,
			name: floor.name,
			floor_name: floor.floor_name,
			is_active: floor.is_active,
			background_color: floor.background_color ?? null,
			background_image: floor.background_image ?? null,
			// Element rows are replaced on every save, so their keys are local only.
			elements: floor.elements.map((element) => ({
				key: `element-${nextId++}`,
				element_type: element.element_type,
				label: element.label ?? null,
				x: element.x,
				y: element.y,
				width: element.width,
				height: element.height,
				rotation: element.rotation,
				color: element.color ?? null,
			})),
			tables: floor.tables.map((table) => ({
				key: table.name,
				name: table.name,
				table_label: table.table_label,
				seats: table.seats,
				shape: table.shape,
				x: table.x,
				y: table.y,
				width: table.width,
				height: table.height,
				rotation: table.rotation,
				is_active: table.is_active,
			})),
		})),
		nextId,
	};
}

function withNewKey(draft: FloorPlanDraft, prefix: string): [string, FloorPlanDraft] {
	return [`new-${prefix}-${draft.nextId}`, { ...draft, nextId: draft.nextId + 1 }];
}

function mapFloor(draft: FloorPlanDraft, floorKey: string, update: (floor: DraftFloor) => DraftFloor): FloorPlanDraft {
	return { ...draft, floors: draft.floors.map((floor) => (floor.key === floorKey ? update(floor) : floor)) };
}

export function findFloor(draft: FloorPlanDraft, floorKey: string | null): DraftFloor | undefined {
	return draft.floors.find((floor) => floor.key === floorKey);
}

export function findItem(draft: FloorPlanDraft, selection: Selection): DraftTable | DraftElement | undefined {
	if (!selection) return undefined;
	const floor = findFloor(draft, selection.floorKey);
	const rows: Array<DraftTable | DraftElement> = selection.kind === "table" ? floor?.tables ?? [] : floor?.elements ?? [];
	return rows.find((row) => row.key === selection.key);
}

// ---- floors ----

export function nextFloorName(draft: FloorPlanDraft): string {
	const taken = new Set(draft.floors.map((floor) => labelKey(floor.floor_name)));
	for (let index = draft.floors.length + 1; ; index++) {
		const name = `Floor ${index}`;
		if (!taken.has(labelKey(name))) return name;
	}
}

export function addFloor(draft: FloorPlanDraft): { draft: FloorPlanDraft; key: string } {
	const [key, next] = withNewKey(draft, "floor");
	const floor: DraftFloor = {
		key,
		floor_name: nextFloorName(draft),
		is_active: true,
		background_color: null,
		background_image: null,
		elements: [],
		tables: [],
	};
	return { draft: { ...next, floors: [...next.floors, floor] }, key };
}

export function updateFloor(
	draft: FloorPlanDraft,
	floorKey: string,
	patch: Partial<Pick<DraftFloor, "floor_name" | "is_active" | "background_color">>,
): FloorPlanDraft {
	return mapFloor(draft, floorKey, (floor) => ({ ...floor, ...patch }));
}

// Order in the draft is the display order that will be saved.
export function moveFloor(draft: FloorPlanDraft, floorKey: string, direction: -1 | 1): FloorPlanDraft {
	const index = draft.floors.findIndex((floor) => floor.key === floorKey);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= draft.floors.length) return draft;
	const floors = [...draft.floors];
	[floors[index], floors[target]] = [floors[target], floors[index]];
	return { ...draft, floors };
}

// Saved floors are deactivated rather than removed in the editor; only a floor
// that was never saved can be dropped.
export function removeUnsavedFloor(draft: FloorPlanDraft, floorKey: string): FloorPlanDraft {
	const floor = findFloor(draft, floorKey);
	if (!floor || floor.name) return draft;
	return { ...draft, floors: draft.floors.filter((row) => row.key !== floorKey) };
}

// ---- tables and elements ----

export function nextTableLabel(draft: FloorPlanDraft): string {
	const labels = draft.floors.flatMap((floor) => floor.tables.map((table) => labelKey(table.table_label)));
	const taken = new Set(labels);
	let highest = 0;
	for (const label of labels) {
		const match = /^t(\d+)$/.exec(label);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	for (let index = highest + 1; ; index++) {
		if (!taken.has(`t${index}`)) return `T${index}`;
	}
}

// Staggers new items from the canvas centre so repeated adds do not stack.
function newItemPosition(floor: DraftFloor, width: number, height: number) {
	const step = ((floor.tables.length + floor.elements.length) % 8) * NEW_ITEM_STEP;
	return { x: CANVAS_WIDTH / 2 - width / 2 + step, y: CANVAS_HEIGHT / 2 - height / 2 + step };
}

export function addTable(draft: FloorPlanDraft, floorKey: string): { draft: FloorPlanDraft; selection: Selection } {
	const floor = findFloor(draft, floorKey);
	if (!floor) return { draft, selection: null };
	const [key, next] = withNewKey(draft, "table");
	const table: DraftTable = clampBox({
		key,
		table_label: nextTableLabel(draft),
		seats: TABLE_DEFAULT.seats,
		shape: TABLE_DEFAULT.shape,
		width: TABLE_DEFAULT.width,
		height: TABLE_DEFAULT.height,
		...newItemPosition(floor, TABLE_DEFAULT.width, TABLE_DEFAULT.height),
		rotation: 0,
		is_active: true,
	});
	return {
		draft: mapFloor(next, floorKey, (row) => ({ ...row, tables: [...row.tables, table] })),
		selection: { kind: "table", floorKey, key },
	};
}

export function addElement(
	draft: FloorPlanDraft,
	floorKey: string,
	elementType: FloorElementType,
): { draft: FloorPlanDraft; selection: Selection } {
	const floor = findFloor(draft, floorKey);
	if (!floor) return { draft, selection: null };
	const [key, next] = withNewKey(draft, "element");
	const defaults = ELEMENT_DEFAULTS[elementType];
	const element: DraftElement = clampBox({
		key,
		element_type: elementType,
		label: defaults.label,
		width: defaults.width,
		height: defaults.height,
		...newItemPosition(floor, defaults.width, defaults.height),
		rotation: 0,
		color: null,
	});
	return {
		draft: mapFloor(next, floorKey, (row) => ({ ...row, elements: [...row.elements, element] })),
		selection: { kind: "element", floorKey, key },
	};
}

export function duplicateItem(draft: FloorPlanDraft, selection: Selection): { draft: FloorPlanDraft; selection: Selection } {
	const item = findItem(draft, selection);
	if (!selection || !item) return { draft, selection };
	const [key, next] = withNewKey(draft, selection.kind);
	const moved = { x: item.x + DUPLICATE_OFFSET, y: item.y + DUPLICATE_OFFSET };
	if (selection.kind === "table") {
		const source = item as DraftTable;
		// No name: the copy is a new table and is saved with its key as client_id.
		const copy: DraftTable = clampBox({ ...source, ...moved, key, name: undefined, table_label: nextTableLabel(draft) });
		return {
			draft: mapFloor(next, selection.floorKey, (floor) => ({ ...floor, tables: [...floor.tables, copy] })),
			selection: { ...selection, key },
		};
	}
	const copy: DraftElement = clampBox({ ...(item as DraftElement), ...moved, key });
	return {
		draft: mapFloor(next, selection.floorKey, (floor) => ({ ...floor, elements: [...floor.elements, copy] })),
		selection: { ...selection, key },
	};
}

export function removeItem(draft: FloorPlanDraft, selection: Selection): FloorPlanDraft {
	if (!selection) return draft;
	return mapFloor(draft, selection.floorKey, (floor) =>
		selection.kind === "table"
			? { ...floor, tables: floor.tables.filter((table) => table.key !== selection.key) }
			: { ...floor, elements: floor.elements.filter((element) => element.key !== selection.key) },
	);
}

// Applies a property or gesture change, keeping the box on the canvas.
export function updateItem(draft: FloorPlanDraft, selection: Selection, patch: ItemPatch): FloorPlanDraft {
	if (!selection) return draft;
	const clean = { ...patch };
	if (clean.seats !== undefined) clean.seats = Math.max(1, Math.round(Number(clean.seats) || 1));
	if (clean.rotation !== undefined) clean.rotation = normalizeRotation(Number(clean.rotation));
	return mapFloor(draft, selection.floorKey, (floor) =>
		selection.kind === "table"
			? {
				...floor,
				tables: floor.tables.map((table) => (table.key === selection.key ? clampBox({ ...table, ...clean }) : table)),
			}
			: {
				...floor,
				elements: floor.elements.map((element) =>
					element.key === selection.key ? clampBox({ ...element, ...clean } as DraftElement) : element,
				),
			},
	);
}

// ---- saving ----

function round(value: number) {
	// Gestures produce long fractions; two decimals is far below one screen pixel.
	return Math.round(value * 100) / 100;
}

export function toSavePayload(draft: FloorPlanDraft, version: string): SaveFloorPlanPayload {
	return {
		version,
		floors: draft.floors.map((floor, index): SaveFloorPlanFloor => {
			const identity = floor.name ? { name: floor.name } : { client_id: floor.key };
			return {
				...identity,
				floor_name: floor.floor_name.trim(),
				display_order: index,
				is_active: floor.is_active,
				background_color: floor.background_color,
				background_image: floor.background_image,
				elements: floor.elements.map((element) => ({
					element_type: element.element_type,
					label: element.label,
					x: round(element.x),
					y: round(element.y),
					width: round(element.width),
					height: round(element.height),
					rotation: round(element.rotation),
					color: element.color,
				})),
				tables: floor.tables.map((table): SaveFloorPlanTable => {
					const tableIdentity = table.name ? { name: table.name } : { client_id: table.key };
					return {
						...tableIdentity,
						table_label: table.table_label.trim(),
						seats: table.seats,
						shape: table.shape,
						x: round(table.x),
						y: round(table.y),
						width: round(table.width),
						height: round(table.height),
						rotation: round(table.rotation),
						is_active: table.is_active,
					};
				}),
			};
		}),
	};
}

export function isDirty(original: FloorPlanDraft | null, draft: FloorPlanDraft | null): boolean {
	if (!original || !draft) return false;
	return JSON.stringify(toSavePayload(original, "").floors) !== JSON.stringify(toSavePayload(draft, "").floors);
}

// Carries the selection and active floor over to the reloaded plan after a save.
export function remapAfterSave(
	before: FloorPlanDraft,
	after: FloorPlanDraft,
	result: Pick<SaveFloorPlanResultDTO, "id_map">,
	selection: Selection,
	activeFloorKey: string | null,
): { selection: Selection; activeFloorKey: string | null } {
	const mapFloorKey = (key: string | null) => (key && (result.id_map.floors[key] ?? key)) || null;
	const floorKey = mapFloorKey(activeFloorKey);
	const nextActive = findFloor(after, floorKey) ? floorKey : after.floors[0]?.key ?? null;
	if (!selection) return { selection: null, activeFloorKey: nextActive };

	const selectedFloorKey = mapFloorKey(selection.floorKey);
	if (!selectedFloorKey) return { selection: null, activeFloorKey: nextActive };
	if (selection.kind === "table") {
		const key = result.id_map.tables[selection.key] ?? selection.key;
		const exists = findFloor(after, selectedFloorKey)?.tables.some((table) => table.key === key);
		return { selection: exists ? { kind: "table", floorKey: selectedFloorKey, key } : null, activeFloorKey: nextActive };
	}
	// Element rows get new keys on reload; their order is preserved, so map by position.
	const index = findFloor(before, selection.floorKey)?.elements.findIndex((element) => element.key === selection.key) ?? -1;
	const element = index >= 0 ? findFloor(after, selectedFloorKey)?.elements[index] : undefined;
	return {
		selection: element ? { kind: "element", floorKey: selectedFloorKey, key: element.key } : null,
		activeFloorKey: nextActive,
	};
}

// Finds the row an API validation error refers to, using the error's meta.
export function findErrorTarget(
	draft: FloorPlanDraft,
	meta: Record<string, unknown> | undefined,
): { floorKey: string; selection: Selection } | null {
	if (!meta) return null;
	const tableLabel = typeof meta.table_label === "string" ? meta.table_label : typeof meta.label === "string" ? meta.label : null;
	if (tableLabel) {
		for (const floor of draft.floors) {
			const table = floor.tables.find((row) => labelKey(row.table_label) === labelKey(tableLabel));
			if (table) return { floorKey: floor.key, selection: { kind: "table", floorKey: floor.key, key: table.key } };
			const element = floor.elements.find(
				(row) => labelKey(row.label || row.element_type) === labelKey(tableLabel),
			);
			if (element) return { floorKey: floor.key, selection: { kind: "element", floorKey: floor.key, key: element.key } };
		}
	}
	const floorName = typeof meta.floor_name === "string" ? meta.floor_name : null;
	if (floorName) {
		const matches = draft.floors.filter((floor) => labelKey(floor.floor_name) === labelKey(floorName));
		// A duplicate name is reported on the later floor, which is the one to fix.
		const floor = matches[matches.length - 1];
		if (floor) return { floorKey: floor.key, selection: null };
	}
	return null;
}
