import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { customerRepository, inCustomerGroups } from "../repositories/customerRepository";

beforeEach(async () => {
	await db.customers.clear();
	await db.customers.bulkPut([
		{ customer: "C-1", customer_name: "Asha Retail", customer_group: "Retail", modified: "2026-01-01" },
		{ customer: "C-2", customer_name: "Asha Wholesale", customer_group: "Wholesale", modified: "2026-01-01" },
		{ customer: "C-3", customer_name: "Asha Ungrouped", modified: "2026-01-01" },
	]);
});

describe("customer search by POS Profile Customer Groups", () => {
	it("shows every customer when the profile has no Customer Groups", async () => {
		for (const groups of [undefined, null, []]) {
			const rows = await customerRepository.search("asha", 20, groups);
			expect(rows.map((row) => row.customer).sort()).toEqual(["C-1", "C-2", "C-3"]);
		}
	});

	it("keeps to the profile's Customer Groups, with and without a query", async () => {
		expect((await customerRepository.search("asha", 20, ["Retail"])).map((row) => row.customer)).toEqual(["C-1"]);
		expect((await customerRepository.search("", 20, ["Wholesale"])).map((row) => row.customer)).toEqual(["C-2"]);
	});

	it("hides a customer with no group from a filtered till", () => {
		expect(inCustomerGroups({ customer_group: undefined }, ["Retail"])).toBe(false);
		expect(inCustomerGroups({ customer_group: undefined }, null)).toBe(true);
	});
});
