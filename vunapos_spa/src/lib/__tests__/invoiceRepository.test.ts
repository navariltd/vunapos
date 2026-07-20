import { beforeEach, describe, expect, it } from "vitest";

import { db } from "./../db";
import { invoiceRepository } from "../invoiceRepository";
import { META_KEYS } from "../repositories/metaRepository";

beforeEach(async () => {
	await Promise.all([
		db.items.clear(),
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
	await db.meta.put({
		key: META_KEYS.posSession,
		value: {
			has_opening_entry: true,
			opening_entry: "OPEN-1",
			cashier: "cashier@example.com",
			pos_profile: "Profile-1",
			ready: true,
			status: "OPEN",
			opened_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			verified_at: new Date().toISOString(),
		},
	});
	await db.meta.put({ key: META_KEYS.offlineSessionTtlHours, value: 12 });
});

describe("invoiceRepository.create", () => {
	it("assembles the cart, writes an immutable queue entry, and returns a local receipt", async () => {
		const result = await invoiceRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 2 }],
			payments: [{ mode_of_payment: "Cash", amount: 232 }],
		});

		expect(result.assembled.totals.grand_total).toBeCloseTo(232, 2);
		expect(result.local_ref).toMatch(/^POS-[A-Z0-9]{8}-00001$/);

		const queued = await db.queue.get(result.local_id);
		expect(queued?.type).toBe("create_invoice");
		if (!queued || queued.type !== "create_invoice") {
			throw new Error("Expected a queued invoice");
		}
		expect(queued?.status).toBe("pending");
		expect(queued?.payload.items).toEqual([{ item_code: "ITEM-1", qty: 2 }]);
		expect(queued?.payload.totals?.grand_total).toBeCloseTo(232, 2);
		expect(queued?.payload.customer).toBe("CUST-1");
		// The device's local_ref rides along in the payload so the server can stamp it onto
		// vunapos_invoice_number_offline - a synced invoice traces back to its offline sale.
		expect(queued?.payload.local_ref).toBe(result.local_ref);
		expect(queued.payload.opening_entry).toBe("OPEN-1");
		expect(queued.payload.cashier).toBe("cashier@example.com");
	});

	it("increments the local_ref counter across successive sales", async () => {
		const first = await invoiceRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 116 }],
		});
		const second = await invoiceRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 116 }],
		});

		expect(first.local_ref.endsWith("00001")).toBe(true);
		expect(second.local_ref.endsWith("00002")).toBe(true);
		expect(await db.queue.count()).toBe(2);
	});

	it("throws and queues nothing when an item has no cached price", async () => {
		await expect(
			invoiceRepository.create({
				customer: "CUST-1",
				items: [{ item_code: "NOT-CACHED", qty: 1 }],
				payments: [],
			}),
		).rejects.toThrow(/No cached price/);

		expect(await db.queue.count()).toBe(0);
	});

	it("throws on an empty cart without touching the queue", async () => {
		await expect(invoiceRepository.create({ items: [], payments: [] })).rejects.toThrow(/empty cart/i);
		expect(await db.queue.count()).toBe(0);
	});

	it("throws before queuing anything when no customer is selected and the profile has no default", async () => {
		await db.profile.put({ name: "Profile-1", taxes_and_charges: "Kenya Tax - TC" });

		await expect(
			invoiceRepository.create({ items: [{ item_code: "ITEM-1", qty: 1 }], payments: [] }),
		).rejects.toThrow(/select a customer/i);

		expect(await db.queue.count()).toBe(0);
	});

	it("throws when there is no active profile cached (bootstrap hasn't run)", async () => {
		await db.profile.clear();

		await expect(
			invoiceRepository.create({ items: [{ item_code: "ITEM-1", qty: 1 }], payments: [] }),
		).rejects.toThrow(/bootstrap must run/i);
	});

	it("throws and queues nothing when no verified open session is cached", async () => {
		await db.meta.delete(META_KEYS.posSession);
		await expect(
			invoiceRepository.create({
				customer: "CUST-1",
				items: [{ item_code: "ITEM-1", qty: 1 }],
				payments: [{ mode_of_payment: "Cash", amount: 116 }],
			}),
		).rejects.toThrow(/verified open POS session/i);
		expect(await db.queue.count()).toBe(0);
	});

	it("throws and queues nothing when the cached session has expired", async () => {
		const session = (await db.meta.get(META_KEYS.posSession))?.value as Record<string, unknown>;
		await db.meta.put({
			key: META_KEYS.posSession,
			value: {
				...session,
				opened_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
			},
		});
		await expect(
			invoiceRepository.create({
				customer: "CUST-1",
				items: [{ item_code: "ITEM-1", qty: 1 }],
				payments: [{ mode_of_payment: "Cash", amount: 116 }],
			}),
		).rejects.toThrow(/session has expired/i);
		expect(await db.queue.count()).toBe(0);
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
			value: {
				add_taxes_from_item_tax_template: true,
				add_taxes_from_taxes_and_charges_template: false,
			},
		});

		const result = await invoiceRepository.create({
			customer: "CUST-1",
			items: [{ item_code: "ITEM-TAXED", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 1392 }],
		});

		expect(result.assembled.totals.total_taxes_and_charges).toBeCloseTo(192, 2);
		expect(result.assembled.totals.grand_total).toBeCloseTo(1392, 2);

		const queued = await db.queue.get(result.local_id);
		expect(queued?.payload.totals?.grand_total).toBeCloseTo(1392, 2);
	});
});
