import { describe, expect, it } from "vitest";

import { bottomNavItems, sidebarItems } from "../navItems";

const labels = (items: Array<{ label: string }>) => items.map((item) => item.label);

describe("retail navigation", () => {
	it("is unchanged by the restaurant cashier flag", () => {
		const expected = ["Home", "Invoices", "Payments", "Customers", "Close Shift"];
		expect(labels(sidebarItems({}, "Retail"))).toEqual(expected);
		expect(labels(sidebarItems({ canTakePayment: false }, "Retail"))).toEqual(expected);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Retail"))).toEqual(expected);
	});

	it("still hides Payments and Customers when they are disabled", () => {
		expect(
			labels(sidebarItems({ allowCustomerPayments: false, allowCustomerManagement: false }, "Retail")),
		).toEqual(["Home", "Invoices", "Close Shift"]);
	});
});

describe("restaurant navigation", () => {
	it("shows Floor and Orders, plus Close Shift only for users who can take payment", () => {
		expect(labels(sidebarItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Floor", "Orders", "Close Shift"]);
		expect(labels(sidebarItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Floor", "Orders"]);
		expect(labels(sidebarItems(undefined, "Restaurant"))).toEqual(["Floor", "Orders"]);
	});

	it("keeps the bottom nav to Floor, Orders and Profile, even for cashiers", () => {
		const expected = ["Floor", "Orders", "Profile"];
		expect(labels(bottomNavItems({ canTakePayment: true }, "Restaurant"))).toEqual(expected);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Restaurant"))).toEqual(expected);
	});

	it("keeps Orders highlighted on the order screen, which is not a nav item itself", () => {
		const orders = sidebarItems({}, "Restaurant").find((item) => item.label === "Orders");
		expect(orders?.activeFor).toEqual(["Order"]);
		expect(labels(sidebarItems({}, "Restaurant"))).not.toContain("Order");
	});
});
