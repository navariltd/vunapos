import { describe, expect, it } from "vitest";

import type { CachedServiceType } from "../../../lib/types";
import { addMenuItem } from "../../restaurant/orderDraft";
import type { KioskOrderDTO } from "../../restaurant/types";
import {
	IDLE_WARNING_SECONDS,
	KIOSK_START,
	back,
	cartQuantity,
	chooseService,
	chooseTable,
	idlePhase,
	idleSecondsLeft,
	kioskSubtotal,
	placed,
	review,
	startOrder,
	tracksIdle,
	updateCart,
} from "../kioskFlow";

const service = (name: string, requiresTable: boolean): CachedServiceType => ({
	name,
	service_type_name: name,
	requires_table: requiresTable,
	display_order: 1,
	is_default: false,
});
const dineIn = service("Dine In", true);
const takeaway = service("Takeaway", false);
let id = 0;
const newKey = () => `key-${++id}`;
const burger = { item_code: "BURGER", item_name: "Burger" };

describe("kiosk flow", () => {
	it("asks for the service type, then a table for dine-in, then shows the menu", () => {
		const start = startOrder([dineIn, takeaway], "Kiosk 1", newKey);
		expect(start.step).toBe("service");
		const table = chooseService(start, dineIn, "Kiosk 1", newKey);
		expect(table.step).toBe("table");
		expect(table.draft).toMatchObject({ pos_profile: "Kiosk 1", service_type: "Dine In", table: null });
		const menu = chooseTable(table, { name: "tbl-1", table_label: "12" });
		expect(menu.step).toBe("menu");
		expect(menu.draft).toMatchObject({ table: "tbl-1", table_label: "12" });
		expect(chooseService(start, takeaway, "Kiosk 1", newKey).step).toBe("menu");
	});

	it("skips the choice when the kiosk offers one service type", () => {
		const state = startOrder([takeaway], "Kiosk 1", newKey);
		expect(state.step).toBe("menu");
		expect(state.draft?.service_type).toBe("Takeaway");
		expect(back(state).step).toBe("service");
	});

	it("opens on the service choice, the kiosk's home screen", () => {
		expect(KIOSK_START.step).toBe("service");
		expect(startOrder([dineIn, takeaway], "Kiosk 1", newKey)).toEqual(KIOSK_START);
	});

	it("starts at a preset table, as a QR code on the table will", () => {
		const entry = { table: { name: "tbl-7", table_label: "7" } };
		const start = startOrder([dineIn, takeaway], "Kiosk 1", newKey, entry);
		const menu = chooseService(start, dineIn, "Kiosk 1", newKey);
		expect(menu.step).toBe("menu");
		expect(menu.draft).toMatchObject({ service_type: "Dine In", table: "tbl-7", table_label: "7" });
		expect(startOrder([dineIn], "Kiosk 1", newKey, entry).step).toBe("menu");
		// Back goes to the service choice, never the table step, and can switch to takeaway with the cart.
		const filled = updateCart(menu, (draft) => addMenuItem(draft, burger, newKey));
		const services = back(filled);
		expect(services.step).toBe("service");
		const switched = chooseService(services, takeaway, "Kiosk 1", newKey);
		expect(switched.step).toBe("menu");
		expect(switched.draft).toMatchObject({ service_type: "Takeaway", table: null });
		expect(cartQuantity(switched)).toBe(1);
	});

	it("gives each order its own key, so a retried checkout places it once", () => {
		const first = chooseService(KIOSK_START, takeaway, "Kiosk 1", newKey);
		const second = chooseService(KIOSK_START, takeaway, "Kiosk 1", newKey);
		expect(first.draft?.idempotency_key).not.toBe(second.draft?.idempotency_key);
	});

	it("reviews only a cart with items, and steps back keeping the cart", () => {
		const menu = chooseTable(chooseService(KIOSK_START, dineIn, "Kiosk 1", newKey), { name: "t", table_label: "1" });
		expect(review(menu)).toBe(menu);
		const filled = updateCart(menu, (draft) => addMenuItem(addMenuItem(draft, burger, newKey), burger, newKey));
		expect(cartQuantity(filled)).toBe(2);
		const reviewing = review(filled);
		expect(reviewing.step).toBe("review");
		expect(back(reviewing)).toEqual({ ...reviewing, step: "menu" });
		expect(back(filled).step).toBe("table");
		const services = back(back(filled));
		expect(services.step).toBe("service");
		expect(cartQuantity(services)).toBe(2);
	});

	it("ends on the confirmation with the order number", () => {
		const order = { session: "RS-1", order_number: 47, kiosk_status: "Awaiting Payment" } as KioskOrderDTO;
		const done = placed(chooseService(KIOSK_START, takeaway, "Kiosk 1", newKey), order);
		expect(done.step).toBe("done");
		expect(done.placed?.order_number).toBe(47);
	});

	it("adds paid choices to the running subtotal", () => {
		const menu = chooseService(KIOSK_START, takeaway, "Kiosk 1", newKey);
		const filled = updateCart(menu, (draft) =>
			addMenuItem(
				addMenuItem(draft, burger, newKey),
				{ ...burger, modifiers: [{ group: "Extras", option: "Cheese", label: "Extras: Cheese", extra_rate: 50 }] },
				newKey,
			),
		);
		expect(kioskSubtotal(filled.draft, new Map([["BURGER", 400]]))).toBe(400 + 450);
		expect(kioskSubtotal(null, new Map())).toBe(0);
	});
});

describe("kiosk idle reset", () => {
	it("tracks inactivity only while a customer is ordering", () => {
		const menu = chooseService(KIOSK_START, takeaway, "Kiosk 1", newKey);
		expect(tracksIdle(KIOSK_START)).toBe(false);
		expect(tracksIdle(menu)).toBe(false);
		const filled = updateCart(menu, (draft) => addMenuItem(draft, burger, newKey));
		expect(tracksIdle(filled)).toBe(true);
		expect(tracksIdle(review(filled))).toBe(true);
		expect(tracksIdle(chooseService(KIOSK_START, dineIn, "Kiosk 1", newKey))).toBe(true);
		expect(tracksIdle({ ...filled, step: "done" })).toBe(false);
	});

	it("warns after the idle time, then starts over after the warning", () => {
		expect(idlePhase(89_999, 90)).toBe("active");
		expect(idlePhase(90_000, 90)).toBe("warning");
		expect(idleSecondsLeft(90_000, 90)).toBe(IDLE_WARNING_SECONDS);
		expect(idleSecondsLeft(100_500, 90)).toBe(5);
		expect(idlePhase((90 + IDLE_WARNING_SECONDS) * 1000, 90)).toBe("expired");
		expect(idleSecondsLeft(200_000, 90)).toBe(0);
	});
});
