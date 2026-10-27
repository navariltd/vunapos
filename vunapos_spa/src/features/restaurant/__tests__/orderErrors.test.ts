import { describe, expect, it } from "vitest";

import { newId } from "../ids";
import { describeOrderError } from "../orderErrors";

describe("describeOrderError", () => {
	it("offers to open the order already on an occupied table", () => {
		expect(describeOrderError({ code: "TABLE_OCCUPIED", message: "x", meta: { order: "VRO-3" } })).toMatchObject({
			action: "open-order",
			order: "VRO-3",
		});
		expect(describeOrderError({ code: "TABLE_OCCUPIED", message: "x" }).action).toBe("pick-table");
	});

	it("drops an item that left the menu and reloads the menu", () => {
		expect(
			describeOrderError({ code: "MENU_ITEM_NOT_AVAILABLE", message: "x", meta: { item_code: "GE-TUSKER" } }),
		).toMatchObject({ action: "reload-menu", itemCode: "GE-TUSKER" });
	});

	it("sends the user back to the right picker", () => {
		expect(describeOrderError({ code: "SERVICE_TYPE_NOT_ALLOWED" }).action).toBe("pick-service-type");
		expect(describeOrderError({ code: "TABLE_REQUIRED" }).action).toBe("pick-table");
		expect(describeOrderError({ code: "TABLE_INACTIVE" }).action).toBe("pick-table");
	});

	it("reloads an order that changed or closed elsewhere", () => {
		expect(describeOrderError({ code: "ORDER_NOT_OPEN" }).action).toBe("reload-order");
		expect(describeOrderError({ code: "ORDER_LINE_NOT_FOUND" }).action).toBe("reload-order");
	});

	it("keeps the server's message for item and input problems, and explains setup errors", () => {
		expect(describeOrderError({ code: "ITEM_NOT_PRICED_FOR_SERVICE_TYPE", message: "No takeaway price" })).toMatchObject({
			message: "No takeaway price",
			action: "none",
		});
		expect(describeOrderError({ code: "SERVICE_TYPE_TAX_TEMPLATE_INVALID", message: "x" }).message).toBe(
			"Ask a manager to check the service type setup.",
		);
	});

	it("falls back to the message, then the fallback", () => {
		expect(describeOrderError({ message: "Network down" })).toEqual({ message: "Network down", action: "none" });
		expect(describeOrderError(null, "Could not load")).toEqual({ message: "Could not load", action: "none" });
	});
});

describe("newId", () => {
	it("builds a version 4 UUID from random bytes", () => {
		const id = newId((bytes) => bytes.fill(0xff));
		expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
		expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(newId()).not.toBe(newId());
	});
});
