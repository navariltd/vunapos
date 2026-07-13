import { describe, expect, it } from "vitest";

import { makeHoldEntry, makeInvoiceEntry } from "../../../../lib/__tests__/fixtures/queueEntries";
import type { HeldInvoiceDTO } from "../../types";
import { mergeHeldInvoices } from "../useHeldInvoicesView";

describe("mergeHeldInvoices (pure)", () => {
	it("maps a pending local hold into a HeldInvoiceDTO with is_local and queue_status pending", () => {
		const entry = makeHoldEntry({
			local_id: "hold-1",
			local_ref: "POS-AAAA-00001",
			status: "pending",
			payload: { customer: "CUST-1", items: [{ item_code: "ITEM-1", qty: 1 }], totals: { grand_total: 116 } },
		});

		const result = mergeHeldInvoices([], [entry]);

		expect(result).toEqual([
			expect.objectContaining({
				name: "POS-AAAA-00001",
				customer: "CUST-1",
				grand_total: 116,
				total: 116,
				is_local: true,
				local_id: "hold-1",
				queue_status: "pending",
			}),
		]);
	});

	it("maps a syncing local hold to queue_status pending, not error", () => {
		const entry = makeHoldEntry({ local_id: "hold-1", status: "syncing" });

		const result = mergeHeldInvoices([], [entry]);

		expect(result[0].queue_status).toBe("pending");
	});

	it("maps a parked (error) local hold to queue_status error", () => {
		const entry = makeHoldEntry({ local_id: "hold-1", status: "error" });

		const result = mergeHeldInvoices([], [entry]);

		expect(result[0].queue_status).toBe("error");
	});

	it("excludes succeeded local holds - once synced it reappears via the normal server listHeld() path", () => {
		const entry = makeHoldEntry({ local_id: "hold-1", status: "succeeded" });

		expect(mergeHeldInvoices([], [entry])).toEqual([]);
	});

	it("excludes archived local holds", () => {
		const entry = makeHoldEntry({ local_id: "hold-1", status: "archived" });

		expect(mergeHeldInvoices([], [entry])).toEqual([]);
	});

	it("excludes create_invoice queue entries - only hold_invoice entries are held invoices", () => {
		const entry = makeInvoiceEntry({ local_id: "sale-1", status: "pending" });

		expect(mergeHeldInvoices([], [entry])).toEqual([]);
	});

	it("prepends local holds ahead of server-confirmed held invoices", () => {
		const serverHeld: HeldInvoiceDTO[] = [{ doctype: "Sales Invoice", name: "SINV-0001" }];
		const localEntry = makeHoldEntry({ local_id: "hold-1", local_ref: "POS-AAAA-00001" });

		const result = mergeHeldInvoices(serverHeld, [localEntry]);

		expect(result.map((r) => r.name)).toEqual(["POS-AAAA-00001", "SINV-0001"]);
	});

	it("returns server-held invoices unchanged when there are no local holds", () => {
		const serverHeld: HeldInvoiceDTO[] = [{ doctype: "Sales Invoice", name: "SINV-0001", customer: "CUST-1" }];

		expect(mergeHeldInvoices(serverHeld, [])).toEqual(serverHeld);
	});
});
