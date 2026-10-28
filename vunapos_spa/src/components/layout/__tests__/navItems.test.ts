import { describe, expect, it } from "vitest";

import type { POSPage } from "../../../lib/stores/navigationStore";
import { bottomNavItems, isItemActive, sidebarFooterItems, sidebarItems, type NavFeatureFlags } from "../navItems";

const labels = (items: Array<{ label: string }>) => items.map((item) => item.label);

describe("retail navigation", () => {
	it("is unchanged by the restaurant cashier flag", () => {
		const expected = ["Home", "Invoices", "Payments", "Customers", "Close Shift"];
		expect(labels(sidebarItems({}, "Retail"))).toEqual(expected);
		expect(labels(sidebarItems({ canTakePayment: false }, "Retail"))).toEqual(expected);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Retail"))).toEqual(expected);
		expect(sidebarFooterItems({ canTakePayment: true, canEditFloorPlan: true }, "Retail")).toEqual([]);
		expect(labels(bottomNavItems({ canTakePayment: true, canEditFloorPlan: true }, "Retail"))).toEqual(expected);
	});

	it("still hides Payments and Customers when they are disabled", () => {
		expect(
			labels(sidebarItems({ allowCustomerPayments: false, allowCustomerManagement: false }, "Retail")),
		).toEqual(["Home", "Invoices", "Close Shift"]);
	});
});

describe("restaurant navigation", () => {
	it("shows New order and Orders in the main navigation for everyone, and no Floor", () => {
		for (const features of [{ canTakePayment: true, canEditFloorPlan: true }, { canTakePayment: false }, undefined]) {
			expect(labels(sidebarItems(features, "Restaurant"))).toEqual(["Order", "Orders"]);
		}
		expect(sidebarItems({}, "Restaurant")[0].title).toBe("New order");
	});

	it("puts Edit floor plan (managers) and Close Shift (cashiers) at the bottom of the sidebar", () => {
		const footer = (features: NavFeatureFlags | undefined) => sidebarFooterItems(features, "Restaurant");
		expect(labels(footer({ canTakePayment: true, canEditFloorPlan: true }))).toEqual(["Floor Editor", "Close Shift"]);
		expect(footer({ canEditFloorPlan: true }).map((item) => item.title)).toEqual(["Edit floor plan"]);
		expect(labels(footer({ canTakePayment: true }))).toEqual(["Close Shift"]);
		expect(footer({ canTakePayment: false })).toEqual([]);
		expect(footer(undefined)).toEqual([]);
	});

	it("gives cashiers a fourth bottom nav item for Close Shift; waiters keep three", () => {
		const bottom = (features: NavFeatureFlags) => bottomNavItems(features, "Restaurant");
		expect(labels(bottom({ canTakePayment: true, canEditFloorPlan: true }))).toEqual(["Order", "Orders", "Close Shift", "Profile"]);
		expect(labels(bottom({ canTakePayment: false, canEditFloorPlan: true }))).toEqual(["Order", "Orders", "Profile"]);
		expect(bottom({})[0].shortTitle).toBe("New order");
	});

	it("highlights New order on a new order (and while picking its table), Orders on a saved one", () => {
		const [newOrder, orders] = sidebarItems({}, "Restaurant");
		const active = (page: POSPage, path: string) =>
			[newOrder, orders].filter((item) => isItemActive(item, page, path)).map((item) => item.label);
		expect(active("Order", "/vunapos/order")).toEqual(["Order"]);
		expect(active("Floor", "/vunapos/floor")).toEqual(["Order"]);
		expect(active("Order", "/vunapos/order/VRO-2026-00001")).toEqual(["Orders"]);
		expect(active("Orders", "/vunapos/orders")).toEqual(["Orders"]);
		expect(active("Profile", "/vunapos/profile")).toEqual([]);
	});
});
