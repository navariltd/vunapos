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
	it("shares Sales History, Payments and Customers with retail", () => {
		const expected = ["Home", "Orders", "Invoices", "Payments", "Customers"];
		expect(labels(sidebarItems({ canTakePayment: true }, "Restaurant"))).toEqual([...expected, "Close Shift"]);
		expect(labels(sidebarItems({ canTakePayment: false }, "Restaurant"))).toEqual(expected);
		expect(labels(sidebarItems(undefined, "Restaurant"))).toEqual(expected);
	});

	it("keeps only Floor below Collapse, regardless of cashier access", () => {
		expect(labels(sidebarFooterItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Floor"]);
		expect(labels(sidebarFooterItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Floor"]);
		expect(labels(sidebarFooterItems(undefined, "Restaurant"))).toEqual(["Floor"]);
	});

	it("keeps all shared and secondary pages reachable on mobile", () => {
		expect(labels(bottomNavItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Home", "Orders", "Invoices", "Payments", "Customers", "Close Shift", "Floor", "Profile"]);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Home", "Orders", "Invoices", "Payments", "Customers", "Floor", "Profile"]);
	});

	it("respects profile feature switches without hiding Floor", () => {
		const features = { allowCustomerPayments: false, allowCustomerManagement: false };
		expect(labels(sidebarItems(features, "Restaurant"))).toEqual(["Home", "Orders", "Invoices"]);
		expect(labels(sidebarFooterItems(features, "Restaurant"))).toEqual(["Floor"]);
	});

	it("keeps Orders highlighted on the order screen, which is not a nav item itself", () => {
		const orders = sidebarItems({}, "Restaurant").find((item) => item.label === "Orders");
		expect(orders?.activeFor).toEqual(["Order"]);
		expect(labels(sidebarItems({}, "Restaurant"))).not.toContain("Order");
	});
});
