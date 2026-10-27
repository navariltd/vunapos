import { describe, expect, it } from "vitest";

import { bottomNavItems, sidebarFooterItems, sidebarItems } from "../navItems";

const labels = (items: Array<{ label: string }>) => items.map((item) => item.label);

describe("retail navigation", () => {
	it("is unchanged by the restaurant cashier flag", () => {
		const expected = ["Home", "Invoices", "Payments", "Customers", "Close Shift"];
		expect(labels(sidebarItems({}, "Retail"))).toEqual(expected);
		expect(labels(sidebarItems({ canTakePayment: false }, "Retail"))).toEqual(expected);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Retail"))).toEqual(expected);
		expect(sidebarFooterItems({ canTakePayment: true }, "Retail")).toEqual([]);
	});

	it("still hides Payments and Customers when they are disabled", () => {
		expect(
			labels(sidebarItems({ allowCustomerPayments: false, allowCustomerManagement: false }, "Retail")),
		).toEqual(["Home", "Invoices", "Close Shift"]);
	});
});

describe("restaurant navigation", () => {
	it("shows Floor and Orders in the main navigation for everyone", () => {
		expect(labels(sidebarItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Floor", "Orders"]);
		expect(labels(sidebarItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Floor", "Orders"]);
		expect(labels(sidebarItems(undefined, "Restaurant"))).toEqual(["Floor", "Orders"]);
	});

	it("puts Close Shift at the bottom of the sidebar, for cashiers only", () => {
		expect(labels(sidebarFooterItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Close Shift"]);
		expect(sidebarFooterItems({ canTakePayment: false }, "Restaurant")).toEqual([]);
		expect(sidebarFooterItems(undefined, "Restaurant")).toEqual([]);
	});

	it("gives cashiers a fourth bottom nav item for Close Shift; waiters keep three", () => {
		expect(labels(bottomNavItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Floor", "Orders", "Close Shift", "Profile"]);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Floor", "Orders", "Profile"]);
	});

	it("keeps Orders highlighted on the order screen, which is not a nav item itself", () => {
		const orders = sidebarItems({}, "Restaurant").find((item) => item.label === "Orders");
		expect(orders?.activeFor).toEqual(["Order"]);
		expect(labels(sidebarItems({}, "Restaurant"))).not.toContain("Order");
	});
});
