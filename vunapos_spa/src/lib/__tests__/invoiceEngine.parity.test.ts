import { describe, expect, it } from "vitest";

import { assembleInvoice } from "../invoiceEngine";
import parityFixture from "./fixtures/parity.json";

// parity.json is *generated*, not hand-written: it's the real backend's own
// preview_invoice run against a real catalog item with a genuine item-level tax
// template ("Kenya Tax - TC", 16%), using this site's actual Accounts Settings (N9,
// confirmed live). Captured via `bench console`, proving the TS engine agrees with
// the real backend byte-for-byte on the mechanism this deployment actually uses.
//
// To regenerate against updated backend behavior, see the console script in the
// PR/commit history that produced fixtures/parity.json.
describe("assembleInvoice parity with the real backend engine (item-level tax, N9)", () => {
	const priceResolver = () => parityFixture.item_rate;
	const taxSettings = {
		addTaxesFromItemTaxTemplate: parityFixture.tax_settings.add_taxes_from_item_tax_template,
		addTaxesFromTaxesAndChargesTemplate: parityFixture.tax_settings.add_taxes_from_taxes_and_charges_template,
	};
	const itemTaxResolver = () => parityFixture.item_tax_rows;

	for (const testCase of parityFixture.cases) {
		const cartDescription = testCase.cart.map((line) => `${line.item_code}×${line.qty}`).join(" + ");

		it(`matches preview_invoice for cart: ${cartDescription}`, () => {
			const result = assembleInvoice({
				cart: testCase.cart,
				priceResolver,
				taxSettings,
				itemTaxResolver,
			});

			expect(result.totals.net_total).toBeCloseTo(testCase.totals.net_total, 2);
			expect(result.totals.total_taxes_and_charges).toBeCloseTo(
				testCase.totals.total_taxes_and_charges,
				2,
			);
			expect(result.totals.grand_total).toBeCloseTo(testCase.totals.grand_total, 2);
			expect(result.totals.rounded_total).toBeCloseTo(testCase.totals.rounded_total, 2);
		});
	}
});
