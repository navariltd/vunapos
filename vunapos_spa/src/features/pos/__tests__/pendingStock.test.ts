import { describe, expect, it } from "vitest";

import { makeHoldEntry, makeInvoiceEntry } from "../../../lib/__tests__/fixtures/queueEntries";
import { applyPendingStock, pendingSaleQuantities } from "../../../lib/pendingStock";

describe("pending offline sale stock", () => {
	it("subtracts pending and syncing sales from cached sellable stock", () => {
		const entries = [
			makeInvoiceEntry({ local_id: "sale-1", status: "pending" }),
			makeInvoiceEntry({
				local_id: "sale-2",
				status: "syncing",
				payload: {
					items: [{ item_code: "ITEM-1", qty: 2 }],
					payments: [],
					local_ref: "POS-TEST-00002",
				},
			}),
		];

		expect(pendingSaleQuantities(entries).get("ITEM-1")).toBe(3);
		expect(
			applyPendingStock(
				[{ item_code: "ITEM-1", item_name: "Widget", actual_qty: 5 }],
				entries,
			)[0].actual_qty,
		).toBe(2);
	});

	it("ignores holds, failed sales, and already synchronized sales", () => {
		const entries = [
			makeHoldEntry({ status: "pending" }),
			makeInvoiceEntry({ local_id: "failed", status: "error" }),
			makeInvoiceEntry({ local_id: "done", status: "succeeded" }),
		];

		expect(pendingSaleQuantities(entries).size).toBe(0);
	});

	it("never displays negative available stock", () => {
		const entries = [
			makeInvoiceEntry({
				payload: {
					items: [{ item_code: "ITEM-1", qty: 10 }],
					payments: [],
					local_ref: "POS-TEST-00001",
				},
			}),
		];

		expect(
			applyPendingStock(
				[{ item_code: "ITEM-1", item_name: "Widget", actual_qty: 2 }],
				entries,
			)[0].actual_qty,
		).toBe(0);
	});
});
