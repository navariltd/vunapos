import { describe, expect, it } from "vitest";

import {
	addMenuItem,
	chooseServiceType,
	chooseTable,
	defaultServiceType,
	draftSubtotal,
	effectiveHeader,
	hasPendingChanges,
	itemQuantities,
	mergeIntoOrder,
	newOrderDraft,
	planSave,
	removeUnsent,
	removeUnsentLines,
	sendBlocker,
	sentNote,
	sentQty,
	setContext,
	setHeader,
	setSentNote,
	setSentQty,
	setUnsentNote,
	setUnsentQty,
	unsentCount,
	withServerOrder,
	type OrderDraft,
} from "../orderDraft";
import type { CachedServiceType } from "../../../lib/types";
import type { RestaurantOrderDTO } from "../types";

let counter = 0;
const nextId = () => `line-${++counter}`;
const biryani = { item_code: "GE-BIRYANI", item_name: "Chicken Biryani" };
const tea = { item_code: "GE-TEA", item_name: "Kenyan Tea", uom: "Nos" };

function fresh(): OrderDraft {
	counter = 0;
	return newOrderDraft({
		pos_profile: "Nairobi",
		service_type: "Dine In",
		table: "tbl-1",
		table_label: "T1",
		customer: "Walk-in Customer",
		customer_name: "Walk-in Customer",
		idempotency_key: "key-1",
	});
}

function serverOrder(overrides: Partial<RestaurantOrderDTO> = {}): RestaurantOrderDTO {
	return {
		name: "VRO-1",
		status: "Open",
		pos_profile: "Nairobi",
		service_type: "Dine In",
		table: "tbl-1",
		table_label: "T1",
		customer: "Walk-in Customer",
		customer_name: "Walk-in Customer",
		pax: 2,
		waiter: "jane@example.com",
		waiter_name: "Jane",
		opened_at: "2026-10-27 12:00:00",
		order_note: null,
		items: [
			{ line_id: "s1", item_code: "GE-BIRYANI", item_name: "Chicken Biryani", qty: 2, uom: "Nos", note: "mild", added_by: "jane", added_at: "" },
		],
		invoice_doctype: null,
		invoice: null,
		modified: "",
		...overrides,
	};
}

describe("unsent lines", () => {
	it("adds a tap to the item's waiting line, but a line with a note stays separate", () => {
		let draft = addMenuItem(fresh(), biryani, nextId);
		draft = addMenuItem(draft, biryani, nextId);
		expect(draft.unsent).toHaveLength(1);
		expect(draft.unsent[0].qty).toBe(2);

		draft = setUnsentNote(draft, draft.unsent[0].line_id, "no chillies");
		draft = addMenuItem(draft, biryani, nextId);
		expect(draft.unsent.map((line) => [line.qty, line.note])).toEqual([[2, "no chillies"], [1, ""]]);
		expect(unsentCount(draft)).toBe(3);
	});

	it("are fully editable and removable", () => {
		let draft = addMenuItem(fresh(), tea, nextId);
		const id = draft.unsent[0].line_id;
		draft = setUnsentQty(draft, id, 0);
		expect(draft.unsent[0].qty).toBe(1);
		draft = setUnsentQty(draft, id, 4);
		expect(draft.unsent[0].qty).toBe(4);
		draft = setUnsentNote(draft, id, "x".repeat(600));
		expect(draft.unsent[0].note).toHaveLength(500);
		expect(removeUnsent(draft, id).unsent).toEqual([]);
	});
});

describe("first save", () => {
	it("is one create_order with every line, its line ids and the idempotency key", () => {
		let draft = addMenuItem(fresh(), biryani, nextId);
		draft = addMenuItem(draft, tea, nextId);
		draft = setHeader(draft, { order_note: "  window seat  " });
		const steps = planSave(draft);
		expect(steps).toEqual([
			{
				kind: "create",
				params: {
					pos_profile: "Nairobi",
					service_type: "Dine In",
					table: "tbl-1",
					customer: "Walk-in Customer",
					order_note: "window seat",
					items: [
						{ line_id: "line-1", item_code: "GE-BIRYANI", qty: 1 },
						{ line_id: "line-2", item_code: "GE-TEA", qty: 1, uom: "Nos" },
					],
					idempotency_key: "key-1",
				},
			},
		]);
	});

	it("needs at least one line", () => {
		expect(planSave(setHeader(fresh(), { order_note: "hello" }))).toEqual([]);
		expect(hasPendingChanges(setHeader(fresh(), { order_note: "hello" }))).toBe(false);
	});

	it("waits for a service type, but its lines still count as pending", () => {
		const draft = addMenuItem({ ...fresh(), service_type: null }, biryani, nextId);
		expect(planSave(draft)).toEqual([]);
		expect(hasPendingChanges(draft)).toBe(true);
	});

	it("lets the service type and table change until the order is saved", () => {
		const changed = setContext(fresh(), { service_type: "Takeaway", table: null, table_label: null });
		expect([changed.service_type, changed.table]).toEqual(["Takeaway", null]);
		const saved = withServerOrder(fresh(), serverOrder());
		expect(setContext(saved, { service_type: "Takeaway", table: null, table_label: null }).service_type).toBe("Dine In");
	});

	it("keeps lines added while it was running and drops the ones it saved", () => {
		let draft = addMenuItem(fresh(), biryani, nextId);
		draft = addMenuItem(draft, tea, nextId);
		const saved = withServerOrder(
			draft,
			serverOrder({ items: [{ line_id: "line-1", item_code: "GE-BIRYANI", item_name: "", qty: 1, uom: "Nos", note: null, added_by: "", added_at: "" }] }),
		);
		expect(saved.unsent.map((line) => line.line_id)).toEqual(["line-2"]);
		expect(saved.idempotency_key).toBe("key-1");
	});
});

describe("later rounds", () => {
	const saved = () => {
		counter = 0;
		return withServerOrder(null, serverOrder());
	};

	it("send header changes, new lines and sent-line edits in that order", () => {
		let draft = setHeader(saved(), { customer: null, customer_name: null });
		draft = addMenuItem(draft, tea, nextId);
		draft = setSentQty(draft, "s1", 3);
		draft = setSentNote(draft, "s1", "extra mild");
		expect(planSave(draft)).toEqual([
			{ kind: "update_order", params: { order: "VRO-1", customer: "" } },
			{ kind: "add_items", params: { order: "VRO-1", items: [{ line_id: "line-1", item_code: "GE-TEA", qty: 1, uom: "Nos" }] } },
			{ kind: "update_item", params: { order: "VRO-1", line_id: "s1", qty: 3, note: "extra mild" } },
		]);
	});

	it("never lower a sent quantity", () => {
		let draft = setSentQty(saved(), "s1", 1);
		expect(sentQty(draft, "s1")).toBe(2);
		expect(planSave(draft)).toEqual([]);
		draft = setSentQty(draft, "s1", 5);
		draft = setSentQty(draft, "s1", 2);
		expect(sentQty(draft, "s1")).toBe(2);
		expect(planSave(draft)).toEqual([]);
	});

	it("drop edits that are changed back", () => {
		let draft = setSentNote(saved(), "s1", "hot");
		expect(sentNote(draft, "s1")).toBe("hot");
		draft = setSentNote(draft, "s1", "mild");
		draft = setHeader(draft, { order_note: "anniversary" });
		draft = setHeader(draft, { order_note: "" });
		expect(hasPendingChanges(draft)).toBe(false);
	});

	it("after a partial failure, only what is still pending is sent again", () => {
		let draft = setHeader(saved(), { order_note: "birthday" });
		draft = addMenuItem(draft, tea, nextId);
		draft = setSentQty(draft, "s1", 3);
		// update_order and add_items succeeded; update_item failed.
		const afterTwo = withServerOrder(
			draft,
			serverOrder({
				order_note: "birthday",
				items: [
					...serverOrder().items,
					{ line_id: "line-1", item_code: "GE-TEA", item_name: "Kenyan Tea", qty: 1, uom: "Nos", note: null, added_by: "", added_at: "" },
				],
			}),
		);
		expect(planSave(afterTwo)).toEqual([{ kind: "update_item", params: { order: "VRO-1", line_id: "s1", qty: 3 } }]);
	});

	it("a reload never overwrites someone else's header change with a stale copy", () => {
		const mine = setHeader(saved(), { order_note: "birthday" });
		// Another device changed the customer meanwhile.
		const reloaded = withServerOrder(mine, serverOrder({ customer: "Amina", customer_name: "Amina" }));
		expect(effectiveHeader(reloaded)).toMatchObject({ customer: "Amina", order_note: "birthday" });
		expect(planSave(reloaded)).toEqual([{ kind: "update_order", params: { order: "VRO-1", order_note: "birthday" } }]);
	});

	it("opening another order discards nothing of it and keeps no stale changes", () => {
		const other = withServerOrder(addMenuItem(saved(), tea, nextId), serverOrder({ name: "VRO-2", items: [] }));
		expect(other.unsent).toEqual([]);
	});
});

describe("draftSubtotal", () => {
	it("prices sent lines (with pending increases) and unsent lines from menu rates", () => {
		let draft = setSentQty(withServerOrder(null, serverOrder()), "s1", 3);
		draft = addMenuItem(draft, tea, nextId);
		draft = addMenuItem(draft, { item_code: "GONE", item_name: "Off menu" }, nextId);
		const rates = new Map([
			["GE-BIRYANI", 950],
			["GE-TEA", 150],
		]);
		expect(draftSubtotal(draft, rates)).toEqual({ amount: 3 * 950 + 150, unpriced: 1 });
	});
});

describe("itemQuantities", () => {
	it("counts each item across sent lines (with raised quantities) and waiting lines", () => {
		let draft = setSentQty(withServerOrder(null, serverOrder()), "s1", 3);
		draft = addMenuItem(draft, biryani, nextId);
		draft = addMenuItem(draft, tea, nextId);
		draft = addMenuItem(draft, tea, nextId);
		expect(Object.fromEntries(itemQuantities(draft))).toEqual({ "GE-BIRYANI": 4, "GE-TEA": 2 });
	});

	it("is empty without a draft", () => {
		expect(itemQuantities(null).size).toBe(0);
	});
});

const serviceType = (name: string, requiresTable: boolean, isDefault = false): CachedServiceType => ({
	name,
	service_type_name: name,
	requires_table: requiresTable,
	display_order: 1,
	is_default: isDefault,
});
const dineIn = serviceType("Dine In", true, true);
const takeaway = serviceType("Takeaway", false);

describe("service type and table before the first save", () => {
	it("uses the profile's default service type, if any", () => {
		expect(defaultServiceType([takeaway, dineIn])?.name).toBe("Dine In");
		expect(defaultServiceType([takeaway])).toBeNull();
	});

	it("clears the table when switching to a type without tables, and keeps the lines", () => {
		const draft = addMenuItem(fresh(), biryani, nextId);
		const switched = chooseServiceType(draft, takeaway);
		expect([switched.service_type, switched.table, switched.table_label]).toEqual(["Takeaway", null, null]);
		expect(switched.unsent).toHaveLength(1);
		expect(chooseServiceType(switched, dineIn).table).toBeNull();
	});

	it("sets a table, but never on a saved order", () => {
		const draft = chooseTable({ ...fresh(), table: null, table_label: null }, { name: "tbl-4", table_label: "T4" });
		expect([draft.table, draft.table_label]).toEqual(["tbl-4", "T4"]);
		const saved = withServerOrder(null, serverOrder());
		expect(chooseTable(saved, { name: "tbl-4", table_label: "T4" }).table).toBe("tbl-1");
	});

	it("says what Send still needs", () => {
		const types = [dineIn, takeaway];
		expect(sendBlocker({ ...fresh(), service_type: null }, types)).toBe("needs-service-type");
		expect(sendBlocker({ ...fresh(), service_type: "Gone" }, types)).toBe("needs-service-type");
		expect(sendBlocker({ ...fresh(), table: null }, types)).toBe("needs-table");
		expect(sendBlocker(fresh(), types)).toBeNull();
		expect(sendBlocker(chooseServiceType(fresh(), takeaway), types)).toBeNull();
		expect(sendBlocker(withServerOrder(null, serverOrder()), [])).toBeNull();
	});

	it("removes chosen lines", () => {
		let draft = addMenuItem(fresh(), biryani, nextId);
		draft = addMenuItem(draft, tea, nextId);
		expect(removeUnsentLines(draft, ["line-1"]).unsent.map((line) => line.item_code)).toEqual(["GE-TEA"]);
	});
});

describe("mergeIntoOrder", () => {
	const building = () => {
		let draft = addMenuItem({ ...fresh(), table: null, table_label: null }, biryani, nextId);
		draft = addMenuItem(draft, tea, nextId);
		return setHeader(draft, { customer: "Amina", customer_name: "Amina" });
	};

	it("moves the lines, with their ids, onto the open order as one new round", () => {
		const { draft, droppedNote } = mergeIntoOrder(building(), serverOrder());
		expect(draft.order?.name).toBe("VRO-1");
		expect([draft.table, draft.service_type]).toEqual(["tbl-1", "Dine In"]);
		expect(droppedNote).toBeNull();
		expect(planSave(draft)).toEqual([
			{
				kind: "add_items",
				params: {
					order: "VRO-1",
					items: [
						{ line_id: "line-1", item_code: "GE-BIRYANI", qty: 1 },
						{ line_id: "line-2", item_code: "GE-TEA", qty: 1, uom: "Nos" },
					],
				},
			},
		]);
	});

	it("keeps the order's customer", () => {
		expect(effectiveHeader(mergeIntoOrder(building(), serverOrder()).draft).customer).toBe("Walk-in Customer");
	});

	it("sends the draft's note when the order has none", () => {
		const { draft, droppedNote } = mergeIntoOrder(setHeader(building(), { order_note: "birthday" }), serverOrder());
		expect(droppedNote).toBeNull();
		expect(planSave(draft)[0]).toEqual({ kind: "update_order", params: { order: "VRO-1", order_note: "birthday" } });
	});

	it("keeps the order's note when both have one, and reports the dropped note", () => {
		const { draft, droppedNote } = mergeIntoOrder(
			setHeader(building(), { order_note: "birthday" }),
			serverOrder({ order_note: "window seat" }),
		);
		expect(droppedNote).toBe("birthday");
		expect(effectiveHeader(draft).order_note).toBe("window seat");
		expect(planSave(draft).map((step) => step.kind)).toEqual(["add_items"]);
	});
});
