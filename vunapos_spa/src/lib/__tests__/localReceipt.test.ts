import { describe, expect, it } from "vitest";

import { renderLocalReceipt } from "../localReceipt";
import type { AssembledInvoice } from "../invoiceEngine";

function makeAssembled(overrides: Partial<AssembledInvoice> = {}): AssembledInvoice {
	return {
		items: [{ item_code: "ITEM-1", qty: 2, rate: 50, amount: 100 }],
		taxes: [{ account_head: "VAT", charge_type: "On Net Total", rate: 16, tax_amount: 16, total: 116, included_in_print_rate: false }],
		totals: { net_total: 100, total_taxes_and_charges: 16, grand_total: 116, rounded_total: 116, rounding_adjustment: 0 },
		...overrides,
	};
}

describe("renderLocalReceipt", () => {
	it("includes the local_ref, item lines, tax rows, and totals", () => {
		const html = renderLocalReceipt({
			localRef: "POS-AB12-00001",
			assembled: makeAssembled(),
			customerName: "Jane Doe",
			payments: [{ mode_of_payment: "Cash", amount: 116 }],
			companyName: "Vuna Fuels Ltd",
			posProfileName: "Station 1",
			currency: "KES",
			postingDate: "2026-07-10",
			postingTime: "14:30:00",
		});

		expect(html).toContain("POS-AB12-00001");
		expect(html).toContain("ITEM-1");
		expect(html).toContain("Jane Doe");
		expect(html).toContain("Vuna Fuels Ltd");
		expect(html).toContain("Cash");
		expect(html).toContain("QUEUED");
		expect(html).toContain("PENDING SYNC");
	});

	it("falls back to Walk-in when no customer name is given", () => {
		const html = renderLocalReceipt({
			localRef: "POS-1",
			assembled: makeAssembled(),
			payments: [],
			postingDate: "2026-07-10",
			postingTime: "14:30:00",
		});

		expect(html).toContain("Walk-in");
	});

	it("escapes HTML in user-controlled fields to prevent injection into the printed receipt", () => {
		const html = renderLocalReceipt({
			localRef: "POS-1",
			assembled: makeAssembled(),
			customerName: '<script>alert("x")</script>',
			payments: [],
			postingDate: "2026-07-10",
			postingTime: "14:30:00",
		});

		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});

	it("is valid enough HTML to hand to an iframe for printing (has doctype and body)", () => {
		const html = renderLocalReceipt({
			localRef: "POS-1",
			assembled: makeAssembled(),
			payments: [{ mode_of_payment: "Cash", amount: 116 }],
			postingDate: "2026-07-10",
			postingTime: "14:30:00",
		});

		expect(html).toMatch(/^<!doctype html>/i);
		expect(html).toContain("<body>");
		expect(html).toContain("</html>");
	});
});
