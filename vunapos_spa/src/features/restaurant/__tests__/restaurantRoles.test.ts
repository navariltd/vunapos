import { describe, expect, it } from "vitest";

import { isRestaurantPageAllowed, restaurantRoleLabel, needsRestaurantShift } from "../restaurantRoles";

describe("restaurant shifts", () => {
	it("requires a personal shift for waiters and cashiers, not kitchen-only users", () => {
		expect(needsRestaurantShift(["VunaPOS Waiter"])).toBe(true);
		expect(needsRestaurantShift(["VunaPOS Cashier"])).toBe(true);
		expect(needsRestaurantShift(["VunaPOS Kitchen User"])).toBe(false);
		expect(needsRestaurantShift(["VunaPOS Restaurant Manager"])).toBe(true);
		expect(needsRestaurantShift([])).toBe(true);
		expect(needsRestaurantShift(["Sales User"])).toBe(true);
		expect(needsRestaurantShift(undefined)).toBe(true);
		expect(needsRestaurantShift(["VunaPOS Kitchen User"], false, true)).toBe(true);
		expect(isRestaurantPageAllowed("Close Shift", false, { canManageShift: true })).toBe(true);
	});
});

describe("restaurantRoleLabel", () => {
	it("names each VunaPOS role", () => {
		expect(restaurantRoleLabel(["VunaPOS Waiter"])).toBe("Waiter");
		expect(restaurantRoleLabel(["VunaPOS Cashier"])).toBe("Cashier");
		expect(restaurantRoleLabel(["VunaPOS Restaurant Manager"])).toBe("Manager");
	});

	it("joins combinations in the order given", () => {
		expect(restaurantRoleLabel(["VunaPOS Cashier", "VunaPOS Restaurant Manager"])).toBe("Cashier · Manager");
	});

	it("falls back when the user has no VunaPOS role", () => {
		expect(restaurantRoleLabel([])).toBe("VunaPOS user");
		expect(restaurantRoleLabel(undefined)).toBe("VunaPOS user");
		expect(restaurantRoleLabel(["Sales User"])).toBe("VunaPOS user");
	});
});

describe("isRestaurantPageAllowed", () => {
	it("allows the floor, order pages and Profile to everyone", () => {
		for (const page of ["Home", "Floor", "Floor Editor", "Orders", "Order", "Profile"] as const) {
			expect(isRestaurantPageAllowed(page, false)).toBe(true);
		}
	});

	it("allows Close Shift only to users who can take payment", () => {
		expect(isRestaurantPageAllowed("Close Shift", true)).toBe(true);
		expect(isRestaurantPageAllowed("Close Shift", false)).toBe(false);
	});

	it("allows shared pages in restaurant mode", () => {
		for (const page of ["Invoices", "Payments", "Customers"] as const) {
			expect(isRestaurantPageAllowed(page, true)).toBe(true);
		}
	});

	it("blocks disabled profile features even on direct navigation", () => {
		const features = { allowCustomerPayments: false, allowCustomerManagement: false };
		expect(isRestaurantPageAllowed("Payments", true, features)).toBe(false);
		expect(isRestaurantPageAllowed("Customers", true, features)).toBe(false);
		expect(isRestaurantPageAllowed("Invoices", true, features)).toBe(true);
	});
});
