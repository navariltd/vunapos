import { describe, expect, it } from "vitest";

import {
	addMenuItem,
	draftSubtotal,
	effectiveHeader,
	hasPendingChanges,
	newOrderDraft,
	planSave,
	removeUnsent,
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
		draft = setHeader(draft, { pax: 3, order_note: "  window seat  " });
		const steps = planSave(draft);
		expect(steps).toEqual([
			{
				kind: "create",
				params: {
					pos_profile: "Nairobi",
					service_type: "Dine In",
					table: "tbl-1",
					customer: "Walk-in Customer",
					pax: 3,
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
		expect(planSave(setHeader(fresh(), { pax: 2 }))).toEqual([]);
		expect(hasPendingChanges(fresh())).toBe(false);
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
		let draft = setHeader(saved(), { pax: 4, customer: null, customer_name: null });
		draft = addMenuItem(draft, tea, nextId);
		draft = setSentQty(draft, "s1", 3);
		draft = setSentNote(draft, "s1", "extra mild");
		expect(planSave(draft)).toEqual([
			{ kind: "update_order", params: { order: "VRO-1", customer: "", pax: 4 } },
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
		draft = setHeader(draft, { pax: 5 });
		draft = setHeader(draft, { pax: 2 });
		expect(hasPendingChanges(draft)).toBe(false);
	});

	it("after a partial failure, only what is still pending is sent again", () => {
		let draft = setHeader(saved(), { pax: 4 });
		draft = addMenuItem(draft, tea, nextId);
		draft = setSentQty(draft, "s1", 3);
		// update_order and add_items succeeded; update_item failed.
		const afterTwo = withServerOrder(
			draft,
			serverOrder({
				pax: 4,
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
		// Another device changed the guests meanwhile.
		const reloaded = withServerOrder(mine, serverOrder({ pax: 6 }));
		expect(effectiveHeader(reloaded)).toMatchObject({ pax: 6, order_note: "birthday" });
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
