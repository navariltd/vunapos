import { describe, expect, it } from "vitest";

import { DEFAULT_ORDERS_FILTER, filterOrders, isFiltered, type OrdersFilter } from "../ordersFilter";
import type { RestaurantOrderSummaryDTO } from "../types";

const order = (
	name: string,
	openedAt: string,
	values: Partial<RestaurantOrderSummaryDTO> = {},
): RestaurantOrderSummaryDTO => ({
	name,
	status: "Open",
	service_type: "Dine In",
	table: null,
	table_label: null,
	customer: null,
	pax: 0,
	waiter: "jane@x",
	waiter_name: "Jane Wanjiku",
	opened_at: openedAt,
	invoice_doctype: null,
	invoice: null,
	modified: openedAt,
	...values,
});

const orders = [
	order("VRO-2", "2026-10-27 12:10:00", { table: "t1", table_label: "T1", customer: "Walk-in Customer" }),
	order("VRO-1", "2026-10-27 12:00:00", { table: "r2", table_label: "R2", waiter: "brian@x" }),
	order("VRO-3", "2026-10-27 12:20:00", { service_type: "Takeaway", customer: "Amina Odhiambo", waiter: "grace@x" }),
	order("VRO-4", "2026-10-27 12:20:00", { table: "t10", table_label: "T10" }),
];
const context: { currentUser: string | null; floorOfTable: Map<string, string> } = {
	currentUser: "jane@x",
	floorOfTable: new Map([
		["t1", "Main Hall"],
		["t10", "Main Hall"],
		["r2", "Terrace"],
	]),
};
const names = (filter: Partial<OrdersFilter>, ctx = context) =>
	filterOrders(orders, { ...DEFAULT_ORDERS_FILTER, ...filter }, ctx).map((row) => row.name);

describe("filterOrders", () => {
	it("lists oldest first by default, breaking ties by order number", () => {
		expect(names({})).toEqual(["VRO-1", "VRO-2", "VRO-3", "VRO-4"]);
	});

	it("lists newest first on request", () => {
		expect(names({ sort: "newest" })).toEqual(["VRO-4", "VRO-3", "VRO-2", "VRO-1"]);
	});

	it("filters by service type", () => {
		expect(names({ serviceType: "Takeaway" })).toEqual(["VRO-3"]);
	});

	it("filters by floor, leaving out orders without a table", () => {
		expect(names({ floor: "Main Hall" })).toEqual(["VRO-2", "VRO-4"]);
		expect(names({ floor: "Terrace" })).toEqual(["VRO-1"]);
	});

	it("keeps only the current user's orders with My orders", () => {
		expect(names({ mine: true })).toEqual(["VRO-2", "VRO-4"]);
		expect(names({ mine: true }, { ...context, currentUser: null })).toEqual([]);
	});

	it("searches table, order number and customer, ignoring case and spaces", () => {
		expect(names({ query: " t1 " })).toEqual(["VRO-2", "VRO-4"]);
		expect(names({ query: "vro-3" })).toEqual(["VRO-3"]);
		expect(names({ query: "amina" })).toEqual(["VRO-3"]);
		expect(names({ query: "nobody" })).toEqual([]);
	});

	it("combines filters and does not reorder its input", () => {
		const input = [...orders];
		expect(names({ floor: "Main Hall", query: "walk", sort: "newest" })).toEqual(["VRO-2"]);
		expect(orders).toEqual(input);
	});
});

describe("kiosk orders", () => {
	const kiosk = [
		...orders,
		order("RS-2026-00041", "2026-10-27 12:30:00", {
			restaurant_session: "RS-2026-00041",
			kiosk_status: "Awaiting Payment",
			order_number: 47,
			sales_orders: ["SAL-ORD-2026-00112"],
		}),
		order("RS-2026-00042", "2026-10-27 12:31:00", {
			restaurant_session: "RS-2026-00042",
			kiosk_status: "Sent to Kitchen",
			order_number: 48,
		}),
	];
	const kioskNames = (filter: Partial<OrdersFilter>) =>
		filterOrders(kiosk, { ...DEFAULT_ORDERS_FILTER, ...filter }, context).map((row) => row.name);

	it("filters to orders awaiting payment", () => {
		expect(kioskNames({ awaitingPayment: true })).toEqual(["RS-2026-00041"]);
		expect(isFiltered({ ...DEFAULT_ORDERS_FILTER, awaitingPayment: true })).toBe(true);
	});

	it("finds an order by its number, its session or its Sales Order", () => {
		expect(kioskNames({ query: "47" })).toEqual(["RS-2026-00041"]);
		expect(kioskNames({ query: "Order 48" })).toEqual(["RS-2026-00042"]);
		expect(kioskNames({ query: "rs-2026-00041" })).toEqual(["RS-2026-00041"]);
		expect(kioskNames({ query: "SAL-ORD-2026-00112" })).toEqual(["RS-2026-00041"]);
	});
});

describe("isFiltered", () => {
	it("ignores the sort order and a blank search", () => {
		expect(isFiltered(DEFAULT_ORDERS_FILTER)).toBe(false);
		expect(isFiltered({ ...DEFAULT_ORDERS_FILTER, sort: "newest", query: "  " })).toBe(false);
		expect(isFiltered({ ...DEFAULT_ORDERS_FILTER, mine: true })).toBe(true);
		expect(isFiltered({ ...DEFAULT_ORDERS_FILTER, floor: "Terrace" })).toBe(true);
	});
});
