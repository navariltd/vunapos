import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { nationalDigits } from "../phoneSearch";
import { customerRepository } from "../repositories/customerRepository";

const FORMATS = ["0790 001 011", "0790001011", "790001011", "+254790001011", "+254-790001011", "254790001011", "00254 790 001 011"];

describe("nationalDigits", () => {
	it("reads every common format of a number as the same digits", () => {
		for (const value of FORMATS) expect(nationalDigits(value, "254"), value).toBe("790001011");
	});

	it("keeps another country's dialling code", () => {
		expect(nationalDigits("+44-2079460958", "254")).toBe("442079460958");
	});

	it("ignores names and too-short input", () => {
		expect(nationalDigits("Wanjiru", "254")).toBeNull();
		expect(nationalDigits("07", "254")).toBeNull();
	});
});

describe("customer search by phone number", () => {
	beforeEach(async () => {
		await db.customers.clear();
		await db.customers.bulkPut([
			{ customer: "C-1", customer_name: "Wanjiru Kamau", mobile_no: "+254-790001011", customer_group: "Retail", modified: "2026-01-01" },
			{ customer: "C-2", customer_name: "Otieno", mobile_no: "0711 222 333", customer_group: "Retail", modified: "2026-01-01" },
			{ customer: "C-3", customer_name: "Hidden", mobile_no: "+254-790001011", customer_group: "Wholesale", modified: "2026-01-01" },
		]);
	});

	it("finds the customer whatever format the number is typed in", async () => {
		for (const query of [...FORMATS, "7900"]) {
			const rows = await customerRepository.search(query, 20, ["Retail"], "254");
			expect(rows.map((row) => row.customer), query).toEqual(["C-1"]);
		}
	});

	it("matches numbers saved in a local format too", async () => {
		const rows = await customerRepository.search("+254 711 222 333", 20, null, "254");
		expect(rows.map((row) => row.customer)).toEqual(["C-2"]);
	});

	it("keeps name search as it was", async () => {
		expect((await customerRepository.search("wanjiru", 20, null, "254")).map((row) => row.customer)).toEqual(["C-1"]);
	});
});
