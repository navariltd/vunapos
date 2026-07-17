import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { itemRepository } from "../repositories/itemRepository";

beforeEach(async () => {
	await db.items.clear();
});

describe("itemRepository", () => {
	it("finds items by item_code prefix", async () => {
		await db.items.bulkPut([
			{ item_code: "FUEL-PETROL", item_name: "Petrol", modified: "2026-01-01" },
			{ item_code: "FUEL-DIESEL", item_name: "Diesel", modified: "2026-01-01" },
			{ item_code: "SHOP-WATER", item_name: "Bottled Water", modified: "2026-01-01" },
		]);

		const results = await itemRepository.search("FUEL");

		expect(results.map((row) => row.item_code).sort()).toEqual(["FUEL-DIESEL", "FUEL-PETROL"]);
	});

	it("falls back to item_name substring match when code prefix has no hits", async () => {
		await db.items.bulkPut([
			{ item_code: "SKU-001", item_name: "Bottled Water 500ml", modified: "2026-01-01" },
		]);

		const results = await itemRepository.search("water");

		expect(results).toHaveLength(1);
		expect(results[0].item_code).toBe("SKU-001");
	});

	it("looks up a single item by barcode", async () => {
		await db.items.put({
			item_code: "SKU-002",
			item_name: "Snack Bar",
			barcode: "012345",
			modified: "2026-01-01",
		});

		const found = await itemRepository.getByBarcode("012345");

		expect(found?.item_code).toBe("SKU-002");
	});
});
