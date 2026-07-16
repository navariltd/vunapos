import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { holdRepository } from "../holdRepository";
import { invoiceRepository } from "../invoiceRepository";
import { META_KEYS } from "../repositories/metaRepository";

beforeEach(async () => {
	await Promise.all([
		db.items.clear(),
		db.itemTaxTemplates.clear(),
		db.taxTemplates.clear(),
		db.profile.clear(),
		db.queue.clear(),
		db.meta.clear(),
	]);
	await db.items.put({ item_code: "ITEM-1", item_name: "Widget", rate: 100, modified: "2026-07-10" });
	await db.taxTemplates.put({
		name: "Kenya Tax - TC",
		modified: "2026-07-10",
		taxes: [{ account_head: "VAT", charge_type: "On Net Total", rate: 16, included_in_print_rate: false }],
	});
	await db.profile.put({ name: "Profile-1", taxes_and_charges: "Kenya Tax - TC" });
});

describe("holdRepository.create", () => {
	it("assembles the cart and writes an immutable hold_invoice queue entry", async () => {
		const result = await holdRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 2 }],
		});

		expect(result.assembled.totals.grand_total).toBeCloseTo(232, 2);
		expect(result.local_ref).toMatch(/^POS-[A-Z0-9]{4}-00001$/);

		const queued = await db.queue.get(result.local_id);
		expect(queued?.type).toBe("hold_invoice");
		expect(queued?.status).toBe("pending");
		expect(queued?.payload.items).toEqual([{ item_code: "ITEM-1", qty: 2 }]);
		expect(queued?.payload.totals?.grand_total).toBeCloseTo(232, 2);
		expect(queued?.payload.customer).toBe("CUST-1");
		// The device's local_ref rides along in the payload so the server can stamp it onto
		// vunapos_invoice_number_offline - a synced hold traces back to its offline origin too.
		expect(queued?.payload.local_ref).toBe(result.local_ref);
	});

	it("queues a payload with no payments/posting_date/posting_time keys - a hold has no sale moment yet", async () => {
		const result = await holdRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 1 }],
		});

		const queued = await db.queue.get(result.local_id);
		expect(queued?.payload).not.toHaveProperty("payments");
		expect(queued?.payload).not.toHaveProperty("posting_date");
		expect(queued?.payload).not.toHaveProperty("posting_time");
	});

	it("shares the local_ref counter with invoiceRepository - a hold and a sale never collide", async () => {
		const sale = await invoiceRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 116 }],
		});
		const hold = await holdRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 1 }],
		});

		expect(sale.local_ref.endsWith("00001")).toBe(true);
		expect(hold.local_ref.endsWith("00002")).toBe(true);
	});

	it("throws and queues nothing when an item has no cached price", async () => {
		await expect(
			holdRepository.create({
				customer: "CUST-1",
				items: [{ item_code: "NOT-CACHED", qty: 1 }],
			}),
		).rejects.toThrow(/No cached price/);

		expect(await db.queue.count()).toBe(0);
	});

	it("throws on an empty cart without touching the queue", async () => {
		await expect(holdRepository.create({ items: [] })).rejects.toThrow(/empty cart/i);
		expect(await db.queue.count()).toBe(0);
	});

	it("throws before queuing anything when no customer is selected and the profile has no default", async () => {
		await db.profile.put({ name: "Profile-1", taxes_and_charges: "Kenya Tax - TC" });

		await expect(
			holdRepository.create({ items: [{ item_code: "ITEM-1", qty: 1 }] }),
		).rejects.toThrow(/select a customer/i);

		expect(await db.queue.count()).toBe(0);
	});

	it("throws when there is no active profile cached (bootstrap hasn't run)", async () => {
		await db.profile.clear();

		await expect(
			holdRepository.create({ items: [{ item_code: "ITEM-1", qty: 1 }] }),
		).rejects.toThrow(/bootstrap must run/i);
	});

	it("taxes an item at its own item-level template rate when that mechanism is active (N9)", async () => {
		await db.items.put({
			item_code: "ITEM-TAXED",
			item_name: "Taxed Widget",
			rate: 1200,
			item_tax_template: "Kenya Tax - TC",
			modified: "2026-07-10",
		});
		await db.itemTaxTemplates.put({
			name: "Kenya Tax - TC",
			modified: "2026-07-10",
			taxes: [{ account_head: "VAT - TC", rate: 16 }],
		});
		await db.meta.put({
			key: META_KEYS.taxSettings,
			value: { add_taxes_from_item_tax_template: true, add_taxes_from_taxes_and_charges_template: false },
		});

		const result = await holdRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-TAXED", qty: 1 }],
		});

		expect(result.assembled.totals.total_taxes_and_charges).toBeCloseTo(192, 2);
		expect(result.assembled.totals.grand_total).toBeCloseTo(1392, 2);

		const queued = await db.queue.get(result.local_id);
		expect(queued?.payload.totals?.grand_total).toBeCloseTo(1392, 2);
	});
});
