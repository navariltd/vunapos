import { describe, expect, it } from "vitest";

import { floorConflicts, floorWarningLabel, floorWarnings, menuItemTag, missingFromMenu } from "../menuConflicts";
import type { UnsentLine } from "../orderDraft";
import type { MenuDTO, MenuItemDTO } from "../types";

const item = (
	item_code: string,
	menu_category: string | null,
	allowed_floors: string[] | null,
	allowed_service_types: string[] | null = null,
) => ({ item_code, item_name: item_code, menu_category, allowed_floors, allowed_service_types }) as MenuItemDTO;

const menu: Pick<MenuDTO, "items" | "categories" | "floors"> = {
	categories: [
		{ item_group: "Food", label: "Food" },
		{ item_group: "Bar", label: "Bar" },
	],
	floors: [
		{ floor: "f-terrace", floor_name: "Terrace" },
		{ floor: "f-vip", floor_name: "VIP" },
	],
	items: [
		item("BIRYANI", "Food", null),
		item("BEER", "Bar", ["f-terrace", "f-vip"]),
		item("WINE", "Bar", ["f-vip"]),
		item("LOBSTER", "Food", ["f-vip"], ["Dine In"]),
	],
};

const line = (line_id: string, item_code: string, qty = 1): UnsentLine => ({
	line_id,
	item_code,
	item_name: item_code,
	qty,
	note: "",
});

describe("floorConflicts", () => {
	const lines = [line("l1", "BIRYANI"), line("l2", "BEER", 2), line("l3", "WINE"), line("l4", "UNKNOWN")];

	it("lists lines whose item isn't served on the floor", () => {
		expect(floorConflicts(lines, menu, "f-main").map((row) => row.line_id)).toEqual(["l2", "l3"]);
		expect(floorConflicts(lines, menu, "f-terrace").map((row) => row.line_id)).toEqual(["l3"]);
		expect(floorConflicts(lines, menu, "f-vip")).toEqual([]);
	});

	it("keeps the quantity and name for the dialog", () => {
		expect(floorConflicts([line("l2", "BEER", 2)], menu, "f-main")).toEqual([
			{ line_id: "l2", item_code: "BEER", item_name: "BEER", qty: 2 },
		]);
	});
});

describe("missingFromMenu", () => {
	it("lists lines whose item another menu doesn't have (unavailable or unpriced)", () => {
		const takeaway = { items: [item("BIRYANI", "Food", null)] };
		expect(missingFromMenu([line("l1", "BIRYANI"), line("l2", "BEER")], takeaway).map((row) => row.line_id)).toEqual(["l2"]);
		expect(missingFromMenu([line("l1", "BIRYANI")], takeaway)).toEqual([]);
	});
});

describe("floor warnings", () => {
	it("names the category when the lines share one", () => {
		expect(floorWarningLabel(floorConflicts([line("l2", "BEER"), line("l3", "WINE")], menu, "f-main"), menu)).toBe(
			"Bar items not served here",
		);
	});

	it("counts items when they span categories", () => {
		const conflicts = floorConflicts([line("l2", "BEER"), line("l4", "LOBSTER"), line("l5", "LOBSTER")], menu, "f-main");
		expect(floorWarningLabel(conflicts, menu)).toBe("2 items not served here");
		expect(floorWarningLabel(conflicts.slice(1), menu)).toBe("Food items not served here");
		expect(floorWarningLabel([], menu)).toBeNull();
	});

	it("maps each floor that can't serve the order to its warning", () => {
		const warnings = floorWarnings([line("l1", "BIRYANI"), line("l3", "WINE")], menu, ["f-main", "f-terrace", "f-vip"]);
		expect(Object.fromEntries(warnings)).toEqual({
			"f-main": "Bar items not served here",
			"f-terrace": "Bar items not served here",
		});
		expect(floorWarnings([], menu, ["f-main"]).size).toBe(0);
		expect(floorWarnings([line("l3", "WINE")], null, ["f-main"]).size).toBe(0);
	});
});

describe("menuItemTag", () => {
	it("says where a limited item is served", () => {
		expect(menuItemTag(menu.items[0], menu)).toBeNull();
		expect(menuItemTag(menu.items[1], menu)).toBe("Terrace · VIP only");
		expect(menuItemTag(menu.items[3], menu)).toBe("VIP · Dine In only");
		expect(menuItemTag(item("X", null, ["f-gone"]), menu)).toBe("f-gone only");
	});
});
