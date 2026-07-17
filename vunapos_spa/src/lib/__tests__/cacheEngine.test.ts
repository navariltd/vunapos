import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as apiClient from "../apiClient";
import { applyDelta, hydrate } from "../cacheEngine";
import { db } from "../db";
import { META_KEYS, metaRepository } from "../repositories/metaRepository";
import type { BootstrapPayload } from "../types";

function makeBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
	return {
		server_time: "2026-07-10 08:00:00",
		bootstrap_version: 1,
		mode: "full",
		pos_profile: { name: "Test Profile", company: "Test Co" },
		items: [{ item_code: "ITEM-1", item_name: "Item One", modified: "2026-07-10 08:00:00" }],
		customers: [
			{ customer: "CUST-1", customer_name: "Customer One", modified: "2026-07-10 08:00:00" },
		],
		tax_templates: [],
		item_tax_templates: [],
		tax_settings: {
			add_taxes_from_item_tax_template: false,
			add_taxes_from_taxes_and_charges_template: true,
		},
		payment_modes: [{ mode_of_payment: "Cash", default: true }],
		...overrides,
	};
}

beforeEach(async () => {
	await Promise.all([
		db.items.clear(),
		db.customers.clear(),
		db.taxTemplates.clear(),
		db.paymentModes.clear(),
		db.profile.clear(),
		db.meta.clear(),
	]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("hydrate", () => {
	it("writes the full snapshot atomically and records sync meta", async () => {
		const payload = makeBootstrap();
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValue(payload);

		await hydrate("Test Profile");

		expect(await db.items.count()).toBe(1);
		expect(await db.customers.count()).toBe(1);
		expect(await db.paymentModes.count()).toBe(1);
		expect(await db.profile.count()).toBe(1);
		expect(await metaRepository.get(META_KEYS.lastFullSync)).toBe(payload.server_time);
		expect(await metaRepository.get(META_KEYS.lastDeltaSync)).toBe(payload.server_time);
		expect(await metaRepository.get(META_KEYS.bootstrapVersion)).toBe(1);
	});

	it("rejects and verifies nothing before hydrate() is even attempted when items are empty", async () => {
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValue(makeBootstrap({ items: [] }));

		await expect(hydrate("Test Profile")).rejects.toThrow(/no sellable items/i);
		expect(await db.items.count()).toBe(0);
	});

	it("leaves the previous cache fully intact when the write transaction fails partway through (I12 atomicity)", async () => {
		// Seed a prior, good snapshot.
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValueOnce(makeBootstrap());
		await hydrate("Test Profile");
		expect(await db.items.count()).toBe(1);
		expect(await db.customers.count()).toBe(1);

		// Second hydrate: items/customers get written first, then paymentModes.bulkPut
		// throws mid-transaction - Dexie/IndexedDB must roll the *entire* transaction
		// back, including the items/customers writes that already ran in this pass.
		const bigPayload = makeBootstrap({
			items: [
				{ item_code: "ITEM-2", item_name: "Item Two", modified: "2026-07-10 09:00:00" },
			],
			customers: [
				{ customer: "CUST-2", customer_name: "Customer Two", modified: "2026-07-10 09:00:00" },
			],
		});
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValueOnce(bigPayload);
		vi.spyOn(db.paymentModes, "bulkPut").mockRejectedValueOnce(new Error("simulated failure"));

		await expect(hydrate("Test Profile")).rejects.toThrow("simulated failure");

		// Previous state intact - not the failed second payload, not a half-write.
		const items = await db.items.toArray();
		expect(items.map((row) => row.item_code)).toEqual(["ITEM-1"]);
		const customers = await db.customers.toArray();
		expect(customers.map((row) => row.customer)).toEqual(["CUST-1"]);
	});
});

describe("applyDelta", () => {
	it("falls back to a full hydrate when there is no prior sync to delta against", async () => {
		const spy = vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValue(makeBootstrap());

		await applyDelta("Test Profile");

		expect(spy).toHaveBeenCalledWith("Test Profile");
		expect(await db.items.count()).toBe(1);
	});

	it("upserts changed rows and evicts deleted rows without touching untouched rows", async () => {
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValueOnce(
			makeBootstrap({
				items: [
					{ item_code: "ITEM-1", item_name: "Item One", modified: "2026-07-10 08:00:00" },
					{ item_code: "ITEM-2", item_name: "Item Two (doomed)", modified: "2026-07-10 08:00:00" },
				],
			}),
		);
		await hydrate("Test Profile");

		const deltaSpy = vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValueOnce({
			...makeBootstrap(),
			mode: "delta",
			server_time: "2026-07-10 10:00:00",
			items: [{ item_code: "ITEM-1", item_name: "Item One (renamed)", modified: "2026-07-10 10:00:00" }],
			customers: [],
			deleted: { Item: ["ITEM-2"], Customer: [] },
		});

		await applyDelta("Test Profile");

		expect(deltaSpy).toHaveBeenCalledWith("Test Profile", "2026-07-10 08:00:00");
		const items = await db.items.toArray();
		expect(items.map((row) => row.item_code).sort()).toEqual(["ITEM-1"]);
		expect(items[0].item_name).toBe("Item One (renamed)");
		expect(await metaRepository.get(META_KEYS.lastDeltaSync)).toBe("2026-07-10 10:00:00");
	});

	it("re-hydrates fully instead of trusting a delta when bootstrap_version has bumped", async () => {
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValueOnce(makeBootstrap({ bootstrap_version: 1 }));
		await hydrate("Test Profile");

		const bumped = makeBootstrap({ bootstrap_version: 2, items: [{ item_code: "ITEM-9", item_name: "Fresh Catalog Item", modified: "2026-07-10 11:00:00" }] });
		vi.spyOn(apiClient, "fetchBootstrap").mockResolvedValueOnce(bumped).mockResolvedValueOnce(bumped);

		await applyDelta("Test Profile");

		expect(await metaRepository.get(META_KEYS.bootstrapVersion)).toBe(2);
		const items = await db.items.toArray();
		expect(items.map((row) => row.item_code)).toEqual(["ITEM-9"]);
	});
});
