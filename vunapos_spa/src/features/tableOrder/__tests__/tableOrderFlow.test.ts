import { describe, expect, it } from "vitest";

import { addMenuItem } from "../../restaurant/orderDraft";
import {
	SENT_MESSAGE,
	backToMenu,
	parseSentOrder,
	resumeSentOrder,
	reviewTableOrder,
	startTableOrder,
	tableCartQuantity,
	tableOrderSent,
	tableTokenFromPath,
	updateTableCart,
	withStatus,
} from "../tableOrderFlow";

let id = 0;
const newKey = () => `key-${++id}`;
const token = "Ab3_-".repeat(9);

describe("table order flow", () => {
	it("reads the token from the table's link only", () => {
		expect(tableTokenFromPath(`/vunapos/table/${token}`)).toBe(token);
		expect(tableTokenFromPath(`/vunapos/table/${token}/`)).toBe(token);
		expect(tableTokenFromPath("/vunapos/table/short")).toBeNull();
		expect(tableTokenFromPath(`/vunapos/table/${token}/extra`)).toBeNull();
		expect(tableTokenFromPath("/vunapos/floor")).toBeNull();
	});

	it("goes from the menu to a review and back, keeping the cart", () => {
		const start = startTableOrder("Dine In", newKey);
		expect(start.step).toBe("menu");
		expect(start.draft.service_type).toBe("Dine In");
		// Nothing to review in an empty cart.
		expect(reviewTableOrder(start)).toBe(start);
		const withItem = updateTableCart(start, (draft) =>
			addMenuItem(draft, { item_code: "BURGER", item_name: "Burger" }, newKey),
		);
		const twice = updateTableCart(withItem, (draft) =>
			addMenuItem(draft, { item_code: "BURGER", item_name: "Burger" }, newKey),
		);
		expect(tableCartQuantity(twice)).toBe(2);
		const reviewing = reviewTableOrder(twice);
		expect(reviewing.step).toBe("review");
		expect(backToMenu(reviewing)).toEqual({ ...twice, step: "menu" });
	});

	it("shows the sent order's status and never edits it after sending", () => {
		const cart = updateTableCart(startTableOrder("Dine In", newKey), (draft) =>
			addMenuItem(draft, { item_code: "TEA", item_name: "Tea" }, newKey),
		);
		const sent = tableOrderSent(reviewTableOrder(cart), { order: "ref-1", status: "Pending" });
		expect(sent.step).toBe("sent");
		expect(updateTableCart(sent, () => ({ ...sent.draft, unsent: [] }))).toBe(sent);
		expect(withStatus(sent, "Accepted").sent).toEqual({ order: "ref-1", status: "Accepted" });
		expect(SENT_MESSAGE.Pending).toEqual({ title: "Order sent", detail: "A waiter will confirm it shortly." });
		expect(SENT_MESSAGE.Rejected.detail).toContain("Please ask a waiter");
	});

	it("resumes a sent order after a refresh, ignoring anything unreadable", () => {
		const fresh = startTableOrder("Dine In", newKey);
		const stored = parseSentOrder(JSON.stringify({ order: "ref-2", status: "Accepted" }));
		expect(resumeSentOrder(fresh, stored)).toMatchObject({ step: "sent", sent: { order: "ref-2", status: "Accepted" } });
		expect(parseSentOrder("not json")).toBeNull();
		expect(parseSentOrder(JSON.stringify({ order: "ref-3", status: "Lost" }))).toBeNull();
		expect(parseSentOrder(null)).toBeNull();
		expect(resumeSentOrder(fresh, null)).toBe(fresh);
	});
});
