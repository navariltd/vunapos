import type { UnsentLine } from "./orderDraft";
import type { MenuDTO, MenuItemDTO } from "./types";

// Lines being built that a table's floor, another service type or another order
// can't take. Nothing is blocked: the user is asked to remove them or go back.
export type ConflictLine = Pick<UnsentLine, "line_id" | "item_code" | "item_name" | "qty">;

function itemsByCode(menu: Pick<MenuDTO, "items">): Map<string, MenuItemDTO> {
	return new Map(menu.items.map((item) => [item.item_code, item]));
}

function asConflict(line: UnsentLine): ConflictLine {
	return { line_id: line.line_id, item_code: line.item_code, item_name: line.item_name, qty: line.qty };
}

// Lines whose item isn't served on the floor, from a menu that spans every floor
// (one fetched without a table). Items missing from that menu are left to the server.
export function floorConflicts(lines: UnsentLine[], menu: Pick<MenuDTO, "items">, floor: string): ConflictLine[] {
	const items = itemsByCode(menu);
	return lines
		.filter((line) => {
			const floors = items.get(line.item_code)?.allowed_floors;
			return Boolean(floors) && !floors?.includes(floor);
		})
		.map(asConflict);
}

// Lines whose item isn't on another menu: not available there, or not priced for
// that service type (the server leaves unpriced items off a service type's menu).
export function missingFromMenu(lines: UnsentLine[], menu: Pick<MenuDTO, "items">): ConflictLine[] {
	const items = itemsByCode(menu);
	return lines.filter((line) => !items.has(line.item_code)).map(asConflict);
}

// "Bar items not served here" when the lines share one menu category, otherwise
// "2 items not served here".
export function floorWarningLabel(conflicts: ConflictLine[], menu: Pick<MenuDTO, "items" | "categories">): string | null {
	if (!conflicts.length) return null;
	const items = itemsByCode(menu);
	const categories = new Set(conflicts.map((line) => items.get(line.item_code)?.menu_category ?? null));
	const [only] = [...categories];
	const label = categories.size === 1 && only ? menu.categories.find((row) => row.item_group === only)?.label : null;
	if (label) return `${label} items not served here`;
	const count = new Set(conflicts.map((line) => line.item_code)).size;
	return `${count} ${count === 1 ? "item" : "items"} not served here`;
}

// The picker's warning per floor, for floors that can't serve some lines.
export function floorWarnings(
	lines: UnsentLine[],
	menu: Pick<MenuDTO, "items" | "categories"> | null,
	floors: string[],
): Map<string, string> {
	const result = new Map<string, string>();
	if (!menu || !lines.length) return result;
	for (const floor of floors) {
		const label = floorWarningLabel(floorConflicts(lines, menu, floor), menu);
		if (label) result.set(floor, label);
	}
	return result;
}

// Where an item may be served, e.g. "Terrace · VIP only" or "Dine In only".
// Null when it's served everywhere.
export function menuItemTag(item: Pick<MenuItemDTO, "allowed_floors" | "allowed_service_types">, menu: Pick<MenuDTO, "floors">): string | null {
	const floorNames = (item.allowed_floors ?? []).map(
		(floor) => menu.floors.find((row) => row.floor === floor)?.floor_name ?? floor,
	);
	const parts = [...floorNames, ...(item.allowed_service_types ?? [])];
	return parts.length ? `${parts.join(" · ")} only` : null;
}
