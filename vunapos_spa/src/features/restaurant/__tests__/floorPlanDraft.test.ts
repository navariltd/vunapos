import { describe, expect, it } from "vitest";

import {
	addElement,
	addFloor,
	addTable,
	duplicateItem,
	findErrorTarget,
	findItem,
	isDirty,
	moveFloor,
	nextTableLabel,
	remapAfterSave,
	removeItem,
	removeUnsavedFloor,
	toDraft,
	toSavePayload,
	updateFloor,
	updateItem,
	type FloorPlanDraft,
} from "../floorPlanDraft";
import type { FloorPlanDTO } from "../types";

const plan: Pick<FloorPlanDTO, "floors"> = {
	floors: [
		{
			name: "floor-a",
			floor_name: "Main Hall",
			display_order: 0,
			is_active: true,
			background_color: null,
			background_image: null,
			elements: [
				{ name: "el-1", element_type: "Wall", label: null, x: 0, y: 0, width: 1000, height: 20, rotation: 0, color: null },
			],
			tables: [
				{ name: "tbl-1", floor: "floor-a", table_label: "T1", seats: 4, shape: "Square", x: 100, y: 100, width: 80, height: 80, rotation: 0, color: null, is_active: true },
				{ name: "tbl-2", floor: "floor-a", table_label: "T2", seats: 2, shape: "Round", x: 300, y: 100, width: 80, height: 80, rotation: 0, color: null, is_active: true },
			],
		},
		{
			name: "floor-b",
			floor_name: "Patio",
			display_order: 1,
			is_active: false,
			background_color: null,
			background_image: null,
			elements: [],
			tables: [],
		},
	],
};

const draft = () => toDraft(plan);

describe("toDraft", () => {
	it("keys saved floors and tables by name and gives elements local keys", () => {
		const loaded = draft();
		expect(loaded.floors.map((floor) => floor.key)).toEqual(["floor-a", "floor-b"]);
		expect(loaded.floors[0].tables.map((table) => table.key)).toEqual(["tbl-1", "tbl-2"]);
		expect(loaded.floors[0].elements[0].key).toMatch(/^element-/);
	});
});

describe("isDirty and toSavePayload", () => {
	it("is clean right after loading and dirty after an edit", () => {
		const original = draft();
		expect(isDirty(original, draft())).toBe(false);
		const edited = updateItem(original, { kind: "table", floorKey: "floor-a", key: "tbl-1" }, { seats: 6 });
		expect(isDirty(original, edited)).toBe(true);
	});

	it("sends names for saved rows, client ids for new ones, and display order by position", () => {
		const withFloor = addFloor(draft());
		const withTable = addTable(withFloor.draft, withFloor.key);
		const payload = toSavePayload(withTable.draft, "v1");

		expect(payload.version).toBe("v1");
		expect(payload.floors.map((floor) => floor.display_order)).toEqual([0, 1, 2]);
		expect(payload.floors[0]).toMatchObject({ name: "floor-a" });
		expect(payload.floors[0].tables[0]).toMatchObject({ name: "tbl-1", table_label: "T1" });
		expect(payload.floors[2]).toMatchObject({ client_id: withFloor.key, floor_name: "Floor 3" });
		expect(payload.floors[2].tables[0]).toMatchObject({ client_id: withTable.selection?.key, table_label: "T3" });
		expect(payload.floors[2]).not.toHaveProperty("name");
	});

	it("rounds gesture fractions and trims labels", () => {
		const edited = updateItem(draft(), { kind: "table", floorKey: "floor-a", key: "tbl-1" }, { x: 101.23456, table_label: " T1 " });
		const table = toSavePayload(edited, "v").floors[0].tables[0];
		expect(table.x).toBe(101.23);
		expect(table.table_label).toBe("T1");
	});
});

describe("floors", () => {
	it("adds a floor with a unique default name", () => {
		const { draft: next, key } = addFloor(draft());
		expect(next.floors.at(-1)).toMatchObject({ key, floor_name: "Floor 3", is_active: true });
	});

	it("renames, deactivates and reorders floors", () => {
		let next = updateFloor(draft(), "floor-b", { floor_name: "Terrace", is_active: true });
		next = moveFloor(next, "floor-b", -1);
		expect(next.floors.map((floor) => floor.floor_name)).toEqual(["Terrace", "Main Hall"]);
		expect(moveFloor(next, "floor-b", -1)).toBe(next);
	});

	it("only removes floors that were never saved", () => {
		const { draft: next, key } = addFloor(draft());
		expect(removeUnsavedFloor(next, key).floors).toHaveLength(2);
		expect(removeUnsavedFloor(next, "floor-a").floors).toHaveLength(3);
	});
});

describe("tables and elements", () => {
	it("picks the next free T label across all floors", () => {
		expect(nextTableLabel(draft())).toBe("T3");
		const renamed = updateItem(draft(), { kind: "table", floorKey: "floor-a", key: "tbl-2" }, { table_label: "t9" });
		expect(nextTableLabel(renamed)).toBe("T10");
	});

	it("adds tables and elements inside the canvas and selects them", () => {
		const added = addTable(draft(), "floor-a");
		const table = findItem(added.draft, added.selection);
		expect(table).toMatchObject({ table_label: "T3", seats: 4, width: 80 });
		const wall = addElement(added.draft, "floor-a", "Bar Counter");
		expect(findItem(wall.draft, wall.selection)).toMatchObject({ element_type: "Bar Counter", label: "Bar", width: 240 });
	});

	it("staggers repeated adds so they do not stack exactly", () => {
		const first = addTable(draft(), "floor-b");
		const second = addTable(first.draft, "floor-b");
		const a = findItem(second.draft, first.selection)!;
		const b = findItem(second.draft, second.selection)!;
		expect([a.x, a.y]).not.toEqual([b.x, b.y]);
	});

	it("duplicates a table as a new row with a new label and an offset", () => {
		const selection = { kind: "table" as const, floorKey: "floor-a", key: "tbl-1" };
		const copy = duplicateItem(draft(), selection);
		const table = findItem(copy.draft, copy.selection);
		expect(table).toMatchObject({ table_label: "T3", x: 120, y: 120 });
		expect(table).not.toHaveProperty("name", "tbl-1");
		const payloadTable = toSavePayload(copy.draft, "v").floors[0].tables.at(-1);
		expect(payloadTable).toHaveProperty("client_id");
	});

	it("deletes the selected row", () => {
		const next = removeItem(draft(), { kind: "table", floorKey: "floor-a", key: "tbl-2" });
		expect(next.floors[0].tables.map((table) => table.key)).toEqual(["tbl-1"]);
	});

	it("clamps and normalises edits", () => {
		const selection = { kind: "table" as const, floorKey: "floor-a", key: "tbl-1" };
		const next = updateItem(draft(), selection, { x: 990, seats: 0, rotation: -90 });
		expect(findItem(next, selection)).toMatchObject({ x: 920, seats: 1, rotation: 270 });
	});
});

describe("after save", () => {
	it("maps the selection and active floor through id_map", () => {
		const { draft: withFloor, key: floorKey } = addFloor(draft());
		const added = addTable(withFloor, floorKey);
		const after: FloorPlanDraft = toDraft({
			floors: [
				...plan.floors,
				{
					name: "floor-c",
					floor_name: "Floor 3",
					display_order: 2,
					is_active: true,
					background_color: null,
					background_image: null,
					elements: [],
					tables: [{ name: "tbl-3", floor: "floor-c", table_label: "T3", seats: 4, shape: "Square", x: 460, y: 310, width: 80, height: 80, rotation: 0, color: null, is_active: true }],
				},
			],
		});
		const result = { id_map: { floors: { [floorKey]: "floor-c" }, tables: { [added.selection!.key]: "tbl-3" } } };

		expect(remapAfterSave(added.draft, after, result, added.selection, floorKey)).toEqual({
			selection: { kind: "table", floorKey: "floor-c", key: "tbl-3" },
			activeFloorKey: "floor-c",
		});
	});

	it("keeps an element selected by its position", () => {
		const before = draft();
		const after = draft();
		const selection = { kind: "element" as const, floorKey: "floor-a", key: before.floors[0].elements[0].key };
		const remapped = remapAfterSave(before, after, { id_map: { floors: {}, tables: {} } }, selection, "floor-a");
		expect(remapped.selection).toEqual({ kind: "element", floorKey: "floor-a", key: after.floors[0].elements[0].key });
	});
});

describe("findErrorTarget", () => {
	it("finds the table named in a validation error", () => {
		expect(findErrorTarget(draft(), { table_label: " t2 " })).toEqual({
			floorKey: "floor-a",
			selection: { kind: "table", floorKey: "floor-a", key: "tbl-2" },
		});
	});

	it("finds the later of two duplicate floor names", () => {
		const renamed = updateFloor(draft(), "floor-b", { floor_name: "main hall" });
		expect(findErrorTarget(renamed, { floor_name: "Main Hall" })).toEqual({ floorKey: "floor-b", selection: null });
	});

	it("returns null when the error does not point at a row", () => {
		expect(findErrorTarget(draft(), { version: "x" })).toBeNull();
		expect(findErrorTarget(draft(), undefined)).toBeNull();
	});
});
