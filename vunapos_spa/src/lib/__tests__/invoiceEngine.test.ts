import { describe, expect, it } from "vitest";

import { assembleInvoice, InvoiceEngineError } from "../invoiceEngine";

// Expected numbers mirror vunapos/tests/test_sales_invoice_flow.py's own
// preview_invoice assertions (same item rate 100, same tax rate 10%), so a live
// parity run against the real backend has a known-good answer to check against.
const priceResolver = (itemCode: string) => (itemCode === "_Test VunaPOS Item" ? 100 : undefined);

const PROFILE_ONLY = {
	addTaxesFromItemTaxTemplate: false,
	addTaxesFromTaxesAndChargesTemplate: true,
};

const ITEM_ONLY = {
	addTaxesFromItemTaxTemplate: true,
	addTaxesFromTaxesAndChargesTemplate: false,
};

describe("assembleInvoice - profile-level tax template", () => {
	it("applies explicit rate and discount overrides before calculating totals", () => {
		const rateResult = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 2, pricing_override: { type: "rate", value: 80 } }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
		});
		const percentageResult = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 2, pricing_override: { type: "discount_percentage", value: 10 } }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
		});
		const amountResult = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 2, pricing_override: { type: "discount_amount", value: 15 } }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
		});

		expect(rateResult.totals.grand_total).toBe(160);
		expect(percentageResult.items[0]).toMatchObject({ rate: 90, discount_percentage: 10, discount_amount: 10 });
		expect(percentageResult.totals.grand_total).toBe(180);
		expect(amountResult.items[0]).toMatchObject({ rate: 85, discount_percentage: 15, discount_amount: 15 });
		expect(amountResult.totals.grand_total).toBe(170);
	});

	it("rejects invalid local price overrides", () => {
		expect(() => assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1, pricing_override: { type: "discount_percentage", value: 101 } }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
		})).toThrow(InvoiceEngineError);
	});
	it("computes net/tax/grand totals for a single exclusive tax row (mirrors backend fixture)", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [{ account_head: "VAT", charge_type: "On Net Total", rate: 10, included_in_print_rate: false }],
		});

		expect(result.totals.net_total).toBeCloseTo(100, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(10, 2);
		expect(result.totals.grand_total).toBeCloseTo(110, 2);
		expect(result.totals.rounded_total).toBeCloseTo(110, 2);
	});

	it("backs an inclusive tax rate out of the entered price (mirrors backend fixture)", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [{ account_head: "VAT", charge_type: "On Net Total", rate: 10, included_in_print_rate: true }],
		});

		expect(result.totals.net_total).toBeCloseTo(90.91, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(9.09, 2);
		expect(result.totals.grand_total).toBeCloseTo(100, 2);
	});

	it("sums multiple lines of the same item before taxing (mirrors backend fixture)", () => {
		const result = assembleInvoice({
			cart: [
				{ item_code: "_Test VunaPOS Item", qty: 2 },
				{ item_code: "_Test VunaPOS Item", qty: 3 },
			],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [{ account_head: "VAT", charge_type: "On Net Total", rate: 10, included_in_print_rate: false }],
		});

		expect(result.items).toHaveLength(2);
		expect(result.totals.net_total).toBeCloseTo(500, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(50, 2);
		expect(result.totals.grand_total).toBeCloseTo(550, 2);
	});

	it("supports multiple tax rows, mixing inclusive and exclusive on the same net base", () => {
		// e.g. a VAT-inclusive fuel price plus an exclusive levy - the general case
		// this engine needs to be ready for once real client tax templates land (N9).
		const result = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver,
			taxSettings: PROFILE_ONLY,
			taxRows: [
				{ account_head: "VAT", charge_type: "On Net Total", rate: 16, included_in_print_rate: true },
				{ account_head: "Levy", charge_type: "On Net Total", rate: 5, included_in_print_rate: false },
			],
		});

		// net_total backs out only the inclusive 16% row: 100 / 1.16 = 86.2069 -> 86.21
		expect(result.totals.net_total).toBeCloseTo(86.21, 2);
		// VAT: 86.21 * 0.16 = 13.7936 -> 13.79 ; Levy: 86.21 * 0.05 = 4.3105 -> 4.31
		expect(result.taxes[0].tax_amount).toBeCloseTo(13.79, 2);
		expect(result.taxes[1].tax_amount).toBeCloseTo(4.31, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(18.1, 2);
		expect(result.totals.grand_total).toBeCloseTo(104.31, 2);
	});

	it("computes a rounding_adjustment when grand_total lands on a fraction of a cent", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver: () => 33.335,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
		});

		expect(result.totals.rounded_total).toBe(round2(33.335));
		expect(result.totals.rounding_adjustment).toBeCloseTo(
			result.totals.rounded_total - result.totals.grand_total,
			5,
		);
	});

	it("rounds totals using ERPNext's smallest currency fraction", () => {
		const single = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver: () => 58.47,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
			roundingSettings: { currencyPrecision: 2, smallestCurrencyFractionValue: 1 },
		});
		const double = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 2 }],
			priceResolver: () => 58.47,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
			roundingSettings: { currencyPrecision: 2, smallestCurrencyFractionValue: 1 },
		});

		expect(single.totals.grand_total).toBe(58.47);
		expect(single.totals.rounded_total).toBe(58);
		expect(single.totals.rounding_adjustment).toBe(-0.47);
		expect(double.totals.grand_total).toBe(116.94);
		expect(double.totals.rounded_total).toBe(117);
		expect(double.totals.rounding_adjustment).toBe(0.06);
	});

	it("rounds to a whole unit when the Currency has no smallest fraction", () => {
		const single = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver: () => 58.47,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
			roundingSettings: {
				currencyPrecision: 2,
				smallestCurrencyFractionValue: 0,
				roundingMethod: "Banker's Rounding",
			},
		});
		const double = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 2 }],
			priceResolver: () => 58.47,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
			roundingSettings: {
				currencyPrecision: 2,
				smallestCurrencyFractionValue: 0,
				roundingMethod: "Banker's Rounding",
			},
		});

		expect(single.totals.rounded_total).toBe(58);
		expect(double.totals.rounded_total).toBe(117);
	});

	it("uses the configured ERPNext rounding method for half units", () => {
		const input = {
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver: () => 58.5,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
		};

		expect(assembleInvoice({ ...input, roundingSettings: { roundingMethod: "Banker's Rounding" } }).totals.rounded_total).toBe(58);
		expect(assembleInvoice({ ...input, roundingSettings: { roundingMethod: "Commercial Rounding" } }).totals.rounded_total).toBe(59);
	});

	it("does not provide a rounded total when the POS Profile disables it", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver: () => 58.47,
			taxSettings: PROFILE_ONLY,
			taxRows: [],
			roundingSettings: {
				currencyPrecision: 2,
				disableRoundedTotal: true,
				smallestCurrencyFractionValue: 1,
			},
		});

		expect(result.totals.rounded_total).toBe(0);
		expect(result.totals.rounding_adjustment).toBe(0);
	});

	it("ignores taxRows entirely when addTaxesFromTaxesAndChargesTemplate is off", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
			priceResolver,
			taxSettings: ITEM_ONLY,
			taxRows: [{ account_head: "VAT", charge_type: "On Net Total", rate: 10 }],
		});

		expect(result.totals.total_taxes_and_charges).toBe(0);
		expect(result.totals.grand_total).toBeCloseTo(100, 2);
	});

	it("throws rather than silently mis-pricing an item with no cached rate", () => {
		expect(() =>
			assembleInvoice({
				cart: [{ item_code: "UNKNOWN-ITEM", qty: 1 }],
				priceResolver,
				taxSettings: PROFILE_ONLY,
				taxRows: [],
			}),
		).toThrow(InvoiceEngineError);
	});

	it("throws on an empty cart instead of returning a zero-total invoice", () => {
		expect(() =>
			assembleInvoice({ cart: [], priceResolver, taxSettings: PROFILE_ONLY, taxRows: [] }),
		).toThrow(InvoiceEngineError);
	});

	it("throws loudly on a charge type it doesn't implement, instead of computing a wrong total", () => {
		expect(() =>
			assembleInvoice({
				cart: [{ item_code: "_Test VunaPOS Item", qty: 1 }],
				priceResolver,
				taxSettings: PROFILE_ONLY,
				taxRows: [{ account_head: "VAT", charge_type: "On Previous Row Total", rate: 10 }],
			}),
		).toThrow(/Unsupported tax charge type/);
	});
});

describe("assembleInvoice - item-level tax template (N9)", () => {
	it("taxes an item at its own assigned rate, added on top (mirrors the real Item-001/Kenya Tax - TC case)", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 1200,
			taxSettings: ITEM_ONLY,
			itemTaxResolver: (code) => (code === "Item-001" ? [{ account_head: "VAT - TC", rate: 16 }] : undefined),
		});

		// 1200 * 16% = 192, matching the real TOTALS_VARIANCE found live (server: 192, device: 0)
		expect(result.totals.net_total).toBeCloseTo(1200, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(192, 2);
		expect(result.totals.grand_total).toBeCloseTo(1392, 2);
	});

	it("leaves items with no assigned template untaxed, even when other lines have one", () => {
		const result = assembleInvoice({
			cart: [
				{ item_code: "Item-001", qty: 1 },
				{ item_code: "Item-002", qty: 1 },
			],
			priceResolver: (code) => (code === "Item-001" ? 1200 : 50),
			taxSettings: ITEM_ONLY,
			itemTaxResolver: (code) => (code === "Item-001" ? [{ account_head: "VAT - TC", rate: 16 }] : undefined),
		});

		expect(result.totals.net_total).toBeCloseTo(1250, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(192, 2);
		expect(result.totals.grand_total).toBeCloseTo(1442, 2);
	});

	it("sums per-item contributions into one row per account when multiple items share a tax account", () => {
		const result = assembleInvoice({
			cart: [
				{ item_code: "A", qty: 1 },
				{ item_code: "B", qty: 1 },
			],
			priceResolver: () => 100,
			taxSettings: ITEM_ONLY,
			itemTaxResolver: () => [{ account_head: "VAT - TC", rate: 16 }],
		});

		expect(result.taxes).toHaveLength(1);
		expect(result.taxes[0].tax_amount).toBeCloseTo(32, 2); // 16 + 16
	});

	it("keeps item tax exclusive when the profile has not marked it inclusive", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 1200,
			taxSettings: ITEM_ONLY,
			itemTaxResolver: () => [{ account_head: "VAT - TC", rate: 16 }],
		});

		expect(result.totals.net_total).toBeCloseTo(1200, 2);
	});

	it("backs inclusive item tax out of the listed rate", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 116,
			taxSettings: ITEM_ONLY,
			itemTaxResolver: () => [
				{ account_head: "VAT - TC", rate: 16, included_in_print_rate: true },
			],
		});

		expect(result.totals.net_total).toBeCloseTo(100, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(16, 2);
		expect(result.totals.grand_total).toBeCloseTo(116, 2);
		expect(result.taxes[0].included_in_print_rate).toBe(true);
	});

	it("uses the item rate and profile inclusivity when both templates share an account", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 1200,
			taxSettings: { addTaxesFromItemTaxTemplate: true, addTaxesFromTaxesAndChargesTemplate: true },
			itemTaxResolver: () => [{ account_head: "VAT - TC", rate: 16 }],
			taxRows: [{ account_head: "VAT - TC", charge_type: "On Net Total", rate: 5 }],
		});

		// ERPNext uses the item-specific 16% rate instead of adding it to the profile's
		// 5% rate. The profile row still owns the tax-row metadata and inclusivity.
		expect(result.taxes).toHaveLength(1);
		expect(result.taxes[0].tax_amount).toBeCloseTo(192, 2);
		expect(result.totals.grand_total).toBeCloseTo(1392, 2);
	});

	it("inherits inclusivity from a matching profile tax row", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 116,
			taxSettings: { addTaxesFromItemTaxTemplate: true, addTaxesFromTaxesAndChargesTemplate: true },
			itemTaxResolver: () => [{ account_head: "VAT - TC", rate: 16 }],
			taxRows: [{ account_head: "VAT - TC", charge_type: "On Net Total", rate: 5, included_in_print_rate: true }],
		});

		expect(result.totals.net_total).toBeCloseTo(100, 2);
		expect(result.totals.total_taxes_and_charges).toBeCloseTo(16, 2);
		expect(result.totals.grand_total).toBeCloseTo(116, 2);
		expect(result.taxes[0].included_in_print_rate).toBe(true);
	});

	it("computes item-level tax on the tax-exclusive base, not the inclusive-tax-laden entered price", () => {
		// Entered price 1160 is profile-level-inclusive of 16% VAT on a net of 1000.
		// Item-level tax (10%, a separate account) must tax that same net 1000, not
		// the raw 1160 - otherwise it double-taxes the inclusive portion.
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 1160,
			taxSettings: { addTaxesFromItemTaxTemplate: true, addTaxesFromTaxesAndChargesTemplate: true },
			itemTaxResolver: () => [{ account_head: "Duty - TC", rate: 10 }],
			taxRows: [
				{ account_head: "VAT - TC", charge_type: "On Net Total", rate: 16, included_in_print_rate: true },
			],
		});

		expect(result.totals.net_total).toBeCloseTo(1000, 2);
		const duty = result.taxes.find((row) => row.account_head === "Duty - TC");
		const vat = result.taxes.find((row) => row.account_head === "VAT - TC");
		expect(duty?.tax_amount).toBeCloseTo(100, 2);
		expect(vat?.tax_amount).toBeCloseTo(160, 2);
		expect(result.totals.grand_total).toBeCloseTo(1260, 2);
	});

	it("applies no item-level tax at all when addTaxesFromItemTaxTemplate is off, even with a resolver present", () => {
		const result = assembleInvoice({
			cart: [{ item_code: "Item-001", qty: 1 }],
			priceResolver: () => 1200,
			taxSettings: PROFILE_ONLY,
			itemTaxResolver: () => [{ account_head: "VAT - TC", rate: 16 }],
		});

		expect(result.totals.total_taxes_and_charges).toBe(0);
	});
});

function round2(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
