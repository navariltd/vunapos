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
	it("shows Close Shift in the sidebar only for users who can take payment", () => {
		expect(labels(sidebarItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Floor", "Close Shift"]);
		expect(labels(sidebarItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Floor"]);
		expect(labels(sidebarItems(undefined, "Restaurant"))).toEqual(["Floor"]);
	});

	it("keeps the bottom nav to Floor and Profile, even for cashiers", () => {
		expect(labels(bottomNavItems({ canTakePayment: true }, "Restaurant"))).toEqual(["Floor", "Profile"]);
		expect(labels(bottomNavItems({ canTakePayment: false }, "Restaurant"))).toEqual(["Floor", "Profile"]);
	});
});
