import { describe, expect, it } from "vitest";

import { isRestaurantPageAllowed, restaurantRoleLabel } from "../restaurantRoles";

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
		for (const page of ["Floor", "Floor Editor", "Orders", "Order", "Profile"] as const) {
			expect(isRestaurantPageAllowed(page, false)).toBe(true);
		}
	});

	it("allows Close Shift only to users who can take payment", () => {
		expect(isRestaurantPageAllowed("Close Shift", true)).toBe(true);
		expect(isRestaurantPageAllowed("Close Shift", false)).toBe(false);
	});

	it("sends retail pages back to the floor", () => {
		for (const page of ["Home", "Invoices", "Payments", "Customers"] as const) {
			expect(isRestaurantPageAllowed(page, true)).toBe(false);
		}
	});
});
