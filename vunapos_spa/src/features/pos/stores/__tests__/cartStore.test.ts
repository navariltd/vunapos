import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../../../lib/db";
import { META_KEYS } from "../../../../lib/repositories/metaRepository";
import type { CustomerDTO, HeldInvoiceDTO, InvoiceDTO, ItemDTO } from "../../types";
import { getActiveCustomer, useCartStore, type CartApi } from "../cartStore";

const previewCart = vi.fn().mockImplementation(async (params: { customer?: string; items: string }) => {
	const items = JSON.parse(params.items) as Array<{
		item_code: string;
		qty: number;
		uom?: string;
		conversion_factor?: number;
		batch_allocations?: Array<{ batch_no: string; qty: number }>;
		serial_allocations?: Array<{ serial_no: string; batch_no?: string | null }>;
		item_note?: string | null;
	}>;
	const rows = items.map((item, index) => ({
		row_name: `server-row-${index}`,
		item_code: item.item_code,
		item_name: item.item_code === "ITEM-1" ? "Widget" : item.item_code,
		qty: item.qty,
		uom: item.uom,
		conversion_factor: item.conversion_factor,
		rate: 100,
		price_list_rate: 100,
		amount: item.qty * 100,
		batch_allocations: item.batch_allocations,
		serial_allocations: item.serial_allocations,
		item_note: item.item_note,
	}));
	const total = rows.reduce((sum, item) => sum + item.amount, 0);
	return {
		doctype: "Sales Invoice",
		name: "Not invoiced yet",
		docstatus: 0,
		customer: params.customer,
		items: rows,
		taxes: [],
		totals: { net_total: total, total_taxes_and_charges: 0, grand_total: total, rounded_total: total },
	};
});

function makeApi(overrides: Partial<CartApi> = {}): CartApi {
	const reject = vi.fn().mockRejectedValue(new Error("unexpected API call in this test"));
	return {
		addItem: reject,
	getItemDetails: reject,
		searchItems: reject,
		resolveBarcode: reject,
		getItemBatches: reject,
		updateItem: reject,
		removeItem: reject,
		clearInvoice: reject,
		createInvoiceFromCart: reject,
		previewInvoice: previewCart,
		createAndSubmitInvoice: reject,
		checkoutInvoice: reject,
		holdInvoice: reject,
		listHeldInvoices: reject,
		restoreInvoice: reject,
		updateInvoiceFromCart: reject,
		renderInvoice: reject,
		...overrides,
	};
}

function makeItem(overrides: Partial<ItemDTO> = {}): ItemDTO {
	return {
		item_code: "ITEM-1",
		item_name: "Widget",
		rate: 100,
		is_stock_item: 0,
		...overrides,
	} as ItemDTO;
}

const CUSTOMER: CustomerDTO = { customer: "CUST-1", customer_name: "Test Customer" };

beforeEach(async () => {
	previewCart.mockClear();
	await Promise.all([
		db.items.clear(),
		db.taxTemplates.clear(),
		db.itemTaxTemplates.clear(),
		db.profile.clear(),
		db.meta.clear(),
	]);
	await db.profile.put({ name: "Profile-1" });
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
	useCartStore.setState({
		invoice: null,
		heldInvoices: [],
		isMutating: false,
		isHeldLoading: false,
		error: null,
		posProfile: "Profile-1",
		defaultCustomer: null,
		selectedCustomerOverride: undefined,
		selectedPriceList: undefined,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getActiveCustomer (tri-state)", () => {
	it("uses defaultCustomer when override is undefined (unset)", () => {
		expect(getActiveCustomer({ selectedCustomerOverride: undefined, defaultCustomer: CUSTOMER })).toEqual(CUSTOMER);
	});

	it("returns null when explicitly cleared, even with a default present", () => {
		expect(getActiveCustomer({ selectedCustomerOverride: null, defaultCustomer: CUSTOMER })).toBeNull();
	});

	it("returns the chosen customer over the default", () => {
		const chosen: CustomerDTO = { customer: "CUST-2", customer_name: "Someone Else" };
		expect(getActiveCustomer({ selectedCustomerOverride: chosen, defaultCustomer: CUSTOMER })).toEqual(chosen);
	});
});

describe("addCartItem", () => {
	it("builds a new local cart from a cached item", async () => {
		await useCartStore.getState().addCartItem(makeItem(), makeApi());

		const invoice = useCartStore.getState().invoice;
		expect(invoice?.is_local).toBe(true);
		expect(invoice?.items).toHaveLength(1);
		expect(invoice?.items[0].item_code).toBe("ITEM-1");
		expect(invoice?.items[0].qty).toBe(1);
	});

	it("increments qty instead of duplicating a row when the same item is added again", async () => {
		await useCartStore.getState().addCartItem(makeItem(), makeApi());
		await useCartStore.getState().addCartItem(makeItem(), makeApi());

		const invoice = useCartStore.getState().invoice;
		expect(invoice?.items).toHaveLength(1);
		expect(invoice?.items[0].qty).toBe(2);
	});

	it("rejects when requested qty exceeds available stock for a stock-controlled item", async () => {
		const scarce = makeItem({ is_stock_item: 1, actual_qty: 0, allow_negative_stock: 0 });

		await expect(useCartStore.getState().addCartItem(scarce, makeApi())).rejects.toThrow(/Insufficient stock/);

		expect(useCartStore.getState().invoice).toBeNull();
	});
});

describe("scanBarcode", () => {
	it("adds the resolved item and increments it on repeated scans", async () => {
		const resolveBarcode = vi.fn().mockResolvedValue({
			ok: true,
			data: makeItem({ barcode: "0123456789" }),
		});
		const api = makeApi({ resolveBarcode });

		await useCartStore.getState().scanBarcode("0123456789", api);
		await useCartStore.getState().scanBarcode("0123456789", api);

		expect(resolveBarcode).toHaveBeenCalledTimes(2);
		expect(useCartStore.getState().invoice?.items).toHaveLength(1);
		expect(useCartStore.getState().invoice?.items[0].qty).toBe(2);
	});

	it("rejects an unknown barcode without creating a cart row", async () => {
		const api = makeApi({
			resolveBarcode: vi.fn().mockResolvedValue({
				ok: false,
				data: null,
				errors: [{ code: "BARCODE_NOT_FOUND", message: "No sellable item was found for barcode missing." }],
			}),
		});

		await expect(useCartStore.getState().scanBarcode("missing", api)).rejects.toThrow(/No .*item was found/);
		expect(useCartStore.getState().invoice).toBeNull();
	});

	it("keeps scanned serial and batch allocations attached to the cart row", async () => {
		const resolveBarcode = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				data: makeItem({
					item_code: "SERIAL-ITEM",
					has_serial_no: 1,
					scan_tracking: { type: "serial", serial_no: "SN-001" },
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				data: makeItem({
					item_code: "BATCH-ITEM",
					has_batch_no: 1,
					scan_tracking: { type: "batch", batch_no: "BATCH-001", available_qty: 5 },
				}),
			});
		const api = makeApi({ resolveBarcode });

		await useCartStore.getState().scanBarcode("SN-001", api);
		await useCartStore.getState().scanBarcode("BATCH-001", api);

		const rows = useCartStore.getState().invoice?.items || [];
		expect(rows[0].serial_allocations).toEqual([{ serial_no: "SN-001", batch_no: null }]);
		expect(rows[1].batch_allocations?.[0].batch_no).toBe("BATCH-001");
	});

	it("preserves the barcode UOM and keeps different UOMs on separate rows", async () => {
		const resolveBarcode = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				data: makeItem({ item_code: "UOM-ITEM", uom: "Box", stock_uom: "Nos", conversion_factor: 12, rate: 1200, barcode: "BOX-001" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				data: makeItem({ item_code: "UOM-ITEM", uom: "Nos", stock_uom: "Nos", conversion_factor: 1, rate: 100, barcode: "NOS-001" }),
			});

		await useCartStore.getState().scanBarcode("BOX-001", makeApi({ resolveBarcode }));
		await useCartStore.getState().scanBarcode("NOS-001", makeApi({ resolveBarcode }));

		const rows = useCartStore.getState().invoice?.items || [];
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ uom: "Box", conversion_factor: 12, qty: 1 });
		expect(rows[1]).toMatchObject({ uom: "Nos", conversion_factor: 1, qty: 1 });
	});
});

describe("updateCartItemQty", () => {
	it("removes the row when qty is set to zero", async () => {
		await useCartStore.getState().addCartItem(makeItem(), makeApi());
		await useCartStore.getState().addCartItem(makeItem({ item_code: "ITEM-2" }), makeApi());
		const rowName = useCartStore.getState().invoice!.items[0].row_name;

		await useCartStore.getState().updateCartItemQty(rowName, 0, makeApi());

		expect(useCartStore.getState().invoice?.items).toHaveLength(1);
	});

	it("nulls the invoice when the last row is removed", async () => {
		await useCartStore.getState().addCartItem(makeItem(), makeApi());
		const rowName = useCartStore.getState().invoice!.items[0].row_name;

		await useCartStore.getState().updateCartItemQty(rowName, 0, makeApi());

		expect(useCartStore.getState().invoice).toBeNull();
	});

	it("clears stale serial and batch allocations when quantity changes", async () => {
		await useCartStore.getState().addCartItem(
			makeItem({ has_batch_no: 1, has_serial_no: 1, actual_qty: 5 }),
			makeApi(),
		);
		const invoice = useCartStore.getState().invoice!;
		useCartStore.setState({
			invoice: {
				...invoice,
				items: [{
					...invoice.items[0],
					serial_and_batch_bundle: "SABB-OLD",
					batch_allocations: [{ batch_no: "BATCH-1", qty: 1 }],
					serial_allocations: [{ serial_no: "SERIAL-1", batch_no: "BATCH-1" }],
				}],
			},
		});

		await useCartStore.getState().updateCartItemQty(invoice.items[0].row_name, 2, makeApi());

		expect(useCartStore.getState().invoice?.items[0]).toMatchObject({
			qty: 2,
			serial_and_batch_bundle: null,
			batch_allocations: [],
			serial_allocations: [],
		});
	});

	// Bug report: an item-level tax vanished after a qty change. Root cause:
	// assembledToInvoiceDTO's item mapping didn't copy item_tax_template onto its
	// output, so the next previewLocalCart pass found none and zeroed the tax.
	it("keeps taxing an item-level-taxed item correctly after a qty change (not just on the initial add)", async () => {
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
		const taxedItem = makeItem({
			item_code: "ITEM-TAXED",
			item_name: "Taxed Widget",
			rate: 1200,
			item_tax_template: "Kenya Tax - TC",
		} as Partial<ItemDTO>);

		await useCartStore.getState().addCartItem(taxedItem, makeApi());
		// Sanity check: the initial add computes tax correctly (192 = 16% of 1200) -
		// the bug only manifests on the *next* preview round-trip.
		expect(useCartStore.getState().invoice?.totals.total_taxes_and_charges).toBeCloseTo(192, 2);

		const rowName = useCartStore.getState().invoice!.items[0].row_name;
		await useCartStore.getState().updateCartItemQty(rowName, 3, makeApi());

		const invoice = useCartStore.getState().invoice;
		expect(invoice?.totals.net_total).toBeCloseTo(3600, 2);
		expect(invoice?.totals.total_taxes_and_charges).toBeCloseTo(576, 2);
		expect(invoice?.totals.grand_total).toBeCloseTo(4176, 2);
		expect(invoice?.taxes?.[0]?.account_head).toBe("VAT - TC");
	});
});

describe("catalogue pricing rule preview", () => {
	it("uses the quantity-one promotional rate without creating a manual override", async () => {
		await useCartStore.getState().addCartItem(makeItem({
			rate: 90,
			price_list_rate: 100,
			pricing_rule: {
				rate: 90,
				discount_percentage: 10,
				pricing_rules: ["RULE-10"],
				preview_qty: 1,
			},
		}), makeApi());

		expect(useCartStore.getState().invoice?.items[0]).toMatchObject({
			rate: 90,
			price_list_rate: 100,
			pricing_override: undefined,
		});
	});

	it("stops assuming a quantity-one rule after quantity changes", async () => {
		await useCartStore.getState().addCartItem(makeItem({
			rate: 90,
			price_list_rate: 100,
			pricing_rule: {
				rate: 90,
				discount_percentage: 10,
				pricing_rules: ["RULE-10"],
				preview_qty: 1,
			},
		}), makeApi());
		const rowName = useCartStore.getState().invoice!.items[0].row_name;

		await useCartStore.getState().updateCartItemQty(rowName, 2, makeApi());

		expect(useCartStore.getState().invoice?.items[0]).toMatchObject({ rate: 100, amount: 200 });
	});
});

describe("live cart pricing rules", () => {
	it("reprices the complete cart on the server when quantity crosses a rule threshold", async () => {
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		const previewInvoice = vi.fn().mockImplementation(async (params: { items: string }) => {
			const [item] = JSON.parse(params.items) as Array<{ item_code: string; qty: number }>;
			const rate = item.qty >= 5 ? 80 : 100;
			return {
				doctype: "Sales Invoice",
				name: "Not invoiced yet",
				docstatus: 0,
				customer: "CUST-1",
				items: [{
					row_name: "server-row",
					item_code: item.item_code,
					item_name: "Widget",
					qty: item.qty,
					rate,
					price_list_rate: 100,
					discount_percentage: item.qty >= 5 ? 20 : 0,
					pricing_rules: item.qty >= 5 ? '["BULK-20"]' : null,
					amount: item.qty * rate,
				}],
				taxes: [],
				totals: {
					net_total: item.qty * rate,
					total_taxes_and_charges: 0,
					grand_total: item.qty * rate,
					rounded_total: item.qty * rate,
				},
			};
		});
		const api = makeApi({ previewInvoice });

		await useCartStore.getState().addCartItem(makeItem(), api);
		const rowName = useCartStore.getState().invoice!.items[0].row_name;
		await useCartStore.getState().updateCartItemQty(rowName, 5, api);

		expect(previewInvoice).toHaveBeenCalledTimes(2);
		expect(useCartStore.getState().invoice?.items[0]).toMatchObject({
			qty: 5,
			rate: 80,
			discount_percentage: 20,
			pricing_rules: '["BULK-20"]',
		});
		expect(useCartStore.getState().invoice?.totals.grand_total).toBe(400);
	});

	it("does not send server-generated free rows back as cashier cart items", async () => {
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		const previewInvoice = vi.fn().mockImplementation(async (params: { items: string }) => {
			const paidItems = JSON.parse(params.items) as Array<{ item_code: string; qty: number }>;
			return {
				doctype: "Sales Invoice",
				name: "Not invoiced yet",
				docstatus: 0,
				customer: "CUST-1",
				items: [
					{ row_name: "paid", item_code: paidItems[0].item_code, item_name: "Widget", qty: paidItems[0].qty, rate: 100, amount: 100 },
					{ row_name: "free", item_code: "FREE-1", item_name: "Gift", qty: 1, rate: 0, amount: 0, is_free_item: true, pricing_rules: '["BUY-GET"]' },
				],
				taxes: [],
				totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
			};
		});
		const api = makeApi({ previewInvoice });

		await useCartStore.getState().addCartItem(makeItem(), api);
		await useCartStore.getState().updateCartItemNote("paid", "Packed", api);

		const secondPayload = JSON.parse(previewInvoice.mock.calls[1][0].items) as Array<{ item_code: string }>;
		expect(secondPayload).toEqual([expect.objectContaining({ item_code: "ITEM-1" })]);
		expect(useCartStore.getState().invoice?.items).toHaveLength(2);
		expect(useCartStore.getState().invoice?.items[1]).toMatchObject({ item_code: "FREE-1", is_free_item: true });
	});
});

describe("updateCartItemPricing", () => {
	it("replaces the previous discount using the original price-list rate", async () => {
		await db.profile.put({
			name: "Profile-1",
			allow_discount_change: true,
			allow_rate_change: true,
		});
		await db.items.put({
			item_code: "ITEM-1",
			item_name: "Widget",
			rate: 100,
			price_list_rate: 100,
			modified: "2026-07-10",
		});
		await useCartStore.getState().addCartItem(makeItem({ rate: 100, price_list_rate: 100 }), makeApi());
		const rowName = useCartStore.getState().invoice!.items[0].row_name;

		await useCartStore.getState().updateCartItemPricing(
			rowName,
			{ type: "discount_percentage", value: 20 },
			makeApi(),
		);
		expect(useCartStore.getState().invoice?.items[0].rate).toBe(80);

		await useCartStore.getState().updateCartItemPricing(
			rowName,
			{ type: "discount_amount", value: 8 },
			makeApi(),
		);
		expect(useCartStore.getState().invoice?.items[0].rate).toBe(92);

		await useCartStore.getState().updateCartItemPricing(
			rowName,
			{ type: "discount_percentage", value: 10 },
			makeApi(),
		);
		expect(useCartStore.getState().invoice?.items[0]).toMatchObject({
			price_list_rate: 100,
			rate: 90,
			discount_percentage: 10,
			discount_amount: 10,
		});
	});
});

describe("refreshCartConfiguration", () => {
	it("recalculates an active cart and replaces stale catalogue metadata", async () => {
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		await useCartStore.getState().addCartItem(makeItem({ rate: 100 }), makeApi());
		await db.items.put({
			item_code: "ITEM-1",
			item_name: "Widget",
			rate: 116,
			actual_qty: 12,
			item_tax_template: "VAT 16%",
			item_tax: {
				template: "VAT 16%",
				tax_rate: 16,
				inclusive_tax_rate: 16,
				exclusive_tax_rate: 0,
				inclusive: true,
				net_rate: 100,
				tax_amount: 16,
				gross_rate: 116,
				accounts: [{ account_head: "VAT - TC", rate: 16, included_in_print_rate: true }],
			},
			modified: "2026-07-29",
		});
		const previewInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice",
			name: "Not invoiced yet",
			docstatus: 0,
			items: [{
				row_name: "server-row",
				item_code: "ITEM-1",
				item_name: "Widget",
				qty: 1,
				rate: 116,
				amount: 116,
			}],
			taxes: [{ account_head: "VAT - TC", rate: 16, tax_amount: 16 }],
			totals: { net_total: 100, total_taxes_and_charges: 16, grand_total: 116, rounded_total: 116 },
		});

		const refreshed = await useCartStore.getState().refreshCartConfiguration(
			makeApi({ previewInvoice }),
		);

		expect(previewInvoice).toHaveBeenCalledOnce();
		expect(refreshed?.totals.grand_total).toBe(116);
		expect(refreshed?.items[0]).toMatchObject({
			rate: 116,
			actual_qty: 12,
			item_tax_template: "VAT 16%",
			item_tax: { inclusive: true, tax_rate: 16 },
		});
		expect(useCartStore.getState().invoice).toEqual(refreshed);
	});

	it("refreshes a customerless cart locally without checkout-grade validation", async () => {
		await useCartStore.getState().addCartItem(makeItem({ rate: 100 }), makeApi());
		await db.items.put({
			item_code: "ITEM-1",
			item_name: "Widget",
			rate: 125,
			price_list_rate: 125,
			actual_qty: 8,
			modified: "2026-07-29",
		});
		const previewInvoice = vi.fn();

		const refreshed = await useCartStore.getState().refreshCartConfiguration(
			makeApi({ previewInvoice }),
		);

		expect(previewInvoice).not.toHaveBeenCalled();
		expect(refreshed?.items[0]).toMatchObject({ rate: 125, price_list_rate: 125, actual_qty: 8 });
		expect(refreshed?.totals.grand_total).toBe(125);
		expect(useCartStore.getState().error).toBeNull();
	});
});

describe("refreshCustomerPricing", () => {
	it("refreshes the catalogue and active cart for the selected customer's price list", async () => {
		await useCartStore.getState().addCartItem(makeItem({ rate: 100 }), makeApi());
		const selected = { customer: "MWENDWA", customer_name: "Mwendwa" };
		useCartStore.getState().setSelectedCustomer(selected);
		const searchItems = vi.fn().mockResolvedValue([makeItem({ rate: 75, price_list_rate: 75 })]);
		const previewInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice",
			name: "Not invoiced yet",
			docstatus: 0,
			customer: selected.customer,
			customer_name: selected.customer_name,
			items: [{
				...useCartStore.getState().invoice!.items[0],
				rate: 75,
				price_list_rate: 75,
				amount: 75,
			}],
			totals: { net_total: 75, grand_total: 75, rounded_total: 75 },
		});

		await useCartStore.getState().refreshCustomerPricing(selected, makeApi({ searchItems, previewInvoice }));

		expect(searchItems).toHaveBeenCalledWith({
			pos_profile: "Profile-1",
			customer: "MWENDWA",
			limit: 100000,
		});
		expect((await db.items.get("ITEM-1"))?.rate).toBe(75);
		expect(useCartStore.getState().invoice?.items[0].rate).toBe(75);
		expect(useCartStore.getState().invoice?.customer).toBe("MWENDWA");
	});
});

describe("refreshPriceListPricing", () => {
	it("reprices the catalogue and current cart using the manually selected list", async () => {
		await useCartStore.getState().addCartItem(makeItem({ rate: 100 }), makeApi());
		const searchItems = vi.fn().mockResolvedValue([makeItem({ rate: 80, price_list_rate: 80 })]);
		const previewInvoice = vi.fn().mockResolvedValue({
			...useCartStore.getState().invoice!,
			selling_price_list: "Wholesale",
			items: [{ ...useCartStore.getState().invoice!.items[0], rate: 80, price_list_rate: 80, amount: 80 }],
			totals: { net_total: 80, grand_total: 80, rounded_total: 80 },
		});

		await useCartStore.getState().refreshPriceListPricing(
			"Wholesale",
			makeApi({ searchItems, previewInvoice }),
		);

		expect(searchItems).toHaveBeenCalledWith({
			pos_profile: "Profile-1",
			customer: undefined,
			price_list: "Wholesale",
			limit: 100000,
		});
		expect(useCartStore.getState().selectedPriceList).toBe("Wholesale");
		expect(useCartStore.getState().invoice?.selling_price_list).toBe("Wholesale");
		expect((await db.items.get("ITEM-1"))?.rate).toBe(80);
	});

	it("customer repricing clears a manual price-list selection", async () => {
		useCartStore.setState({ selectedPriceList: "Wholesale" });
		const searchItems = vi.fn().mockResolvedValue([]);

		await useCartStore.getState().refreshCustomerPricing(null, makeApi({ searchItems }));

		expect(useCartStore.getState().selectedPriceList).toBeUndefined();
	});
});

describe("validateCart", () => {
	it("stores the exact loyalty credit returned by the server preview", async () => {
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		await useCartStore.getState().addCartItem(makeItem(), makeApi());
		const previewInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice",
			name: "Not invoiced yet",
			docstatus: 0,
			customer: "CUST-1",
			items: [{ row_name: "server-row", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
			taxes: [],
			loyalty_points: 20,
			loyalty_amount: 12.5,
			totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
		});

		const preview = await useCartStore.getState().previewLoyaltyRedemption(20, makeApi({ previewInvoice }));

		expect(previewInvoice).toHaveBeenCalledWith(expect.objectContaining({ loyalty_points: 20 }));
		expect(preview).toMatchObject({ loyalty_points: 20, loyalty_amount: 12.5 });
		expect(useCartStore.getState().invoice).toMatchObject({ loyalty_points: 20, loyalty_amount: 12.5 });
	});

	it("repairs a stale partial serial selection before requesting automatic allocation", async () => {
		useCartStore.setState({
			defaultCustomer: CUSTOMER,
			invoice: {
				doctype: "VunaPOS Cart",
				name: "Not invoiced yet",
				docstatus: 0,
				is_local: true,
				items: [{
					row_name: "row-1",
					item_code: "SERIAL-BATCH-1",
					item_name: "Batched and Serialed 1",
					qty: 2,
					rate: 100,
					amount: 200,
					has_batch_no: 1,
					has_serial_no: 1,
					serial_allocations: [{ serial_no: "SERIAL-1", batch_no: "BATCH-1" }],
				}],
				totals: { grand_total: 200, rounded_total: 200 },
			},
		});
		const previewInvoice = vi.fn().mockImplementation(async (params: { items: string }) => {
			const submittedItems = JSON.parse(params.items);
			expect(submittedItems[0].serial_allocations).toEqual([]);
			return {
				doctype: "Sales Invoice",
				name: "Not invoiced yet",
				docstatus: 0,
				items: [{
					...useCartStore.getState().invoice!.items[0],
					serial_allocations: [
						{ serial_no: "SERIAL-1", batch_no: "BATCH-1" },
						{ serial_no: "SERIAL-2", batch_no: "BATCH-1" },
					],
				}],
				totals: { grand_total: 200, rounded_total: 200 },
			};
		});

		const validated = await useCartStore.getState().validateCart(makeApi({ previewInvoice }));

		expect(validated?.items[0].serial_allocations).toHaveLength(2);
	});
});

describe("clearCart", () => {
	it("empties a brand-new local cart directly, no API call needed", async () => {
		await useCartStore.getState().addCartItem(makeItem(), makeApi());

		await useCartStore.getState().clearCart(makeApi());

		expect(useCartStore.getState().invoice).toBeNull();
	});

	it("is a no-op-safe call when the cart is already empty", async () => {
		await expect(useCartStore.getState().clearCart(makeApi())).resolves.toBeUndefined();
		expect(useCartStore.getState().invoice).toBeNull();
	});

	it("clears the server-side draft and refreshes held invoices when backed by a source invoice", async () => {
		useCartStore.setState({
			invoice: {
				doctype: "Sales Invoice",
				name: "Not invoiced yet",
				docstatus: 0,
				is_local: true,
				source_invoice_doctype: "Sales Invoice",
				source_invoice_name: "SINV-0009",
				items: [{ row_name: "r1", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
				totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
			},
		});
		const clearInvoice = vi.fn().mockResolvedValue({});
		const listHeldInvoices = vi.fn().mockResolvedValue([]);

		await useCartStore.getState().clearCart(makeApi({ clearInvoice, listHeldInvoices }));

		expect(clearInvoice).toHaveBeenCalledWith(
			expect.objectContaining({ invoice_doctype: "Sales Invoice", invoice_name: "SINV-0009" }),
		);
		expect(listHeldInvoices).toHaveBeenCalled();
		expect(useCartStore.getState().invoice).toBeNull();
	});
});

describe("submitCart", () => {
	beforeEach(async () => {
		await db.items.put({ item_code: "ITEM-1", item_name: "Widget", rate: 100, modified: "2026-07-10" });
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		await useCartStore.getState().addCartItem(makeItem(), makeApi());
	});

	it("returns null when there is no active cart", async () => {
		useCartStore.setState({ invoice: null });

		const result = await useCartStore.getState().submitCart([], null, "idem-1", makeApi(), true);

		expect(result).toBeNull();
	});

	it("sends manual multi-batch allocations directly to the server", async () => {
		const row = useCartStore.getState().invoice?.items[0];
		expect(row).toBeDefined();
		await useCartStore.getState().updateCartItemBatchAllocations(
			row!.row_name,
			[
				{ batch_no: "BATCH-A", qty: 0.4 },
				{ batch_no: "BATCH-B", qty: 0.6 },
			],
			makeApi(),
		);

		const createAndSubmitInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice", name: "SINV-1", docstatus: 1, items: [], totals: {},
		});
		await useCartStore.getState().submitCart(
			[{ mode_of_payment: "Cash", amount: 100 }], null, "idem-batches",
			makeApi({
				getItemDetails: vi.fn().mockResolvedValue(makeItem()),
				createAndSubmitInvoice,
				renderInvoice: vi.fn().mockRejectedValue(new Error("no print")),
			}), true,
		);

		const submittedItems = JSON.parse(createAndSubmitInvoice.mock.calls[0][0].items);
		expect(submittedItems[0].batch_allocations).toEqual([
			{ batch_no: "BATCH-A", qty: 0.4 },
			{ batch_no: "BATCH-B", qty: 0.6 },
		]);
	});

	it("rejects an incomplete saved manual allocation", async () => {
		const row = useCartStore.getState().invoice?.items[0];
		await expect(
			useCartStore.getState().updateCartItemBatchAllocations(
				row!.row_name,
				[{ batch_no: "BATCH-A", qty: 0.5 }],
				makeApi(),
			),
		).rejects.toThrow(/must equal the quantity/);
	});

	it("submits directly with the checkout idempotency key and clears the cart", async () => {
		await db.items.put({ item_code: "ITEM-1", item_name: "Widget", rate: 100, actual_qty: 5, modified: "2026-07-10" });
		const createAndSubmitInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice", name: "ACC-SINV-0001", docstatus: 1, items: [], totals: {},
		});
		const renderInvoice = vi.fn().mockResolvedValue({
			invoice_doctype: "Sales Invoice",
			invoice_name: "ACC-SINV-0001",
			print_format: null,
			html: "<html>receipt</html>",
		});

		const result = await useCartStore
			.getState()
			.submitCart([{ mode_of_payment: "Cash", amount: 100 }], null, "idem-1", makeApi({
				getItemDetails: vi.fn().mockResolvedValue(makeItem({ actual_qty: 4 })), createAndSubmitInvoice, renderInvoice,
			}), true);

		expect(result?.invoice.name).toBe("ACC-SINV-0001");
		expect(result?.invoice.docstatus).toBe(1);
		expect(result?.printPayload?.html).toContain("receipt");
		expect(useCartStore.getState().invoice).toBeNull();
		expect((await db.items.get("ITEM-1"))?.actual_qty).toBe(4);
		expect(createAndSubmitInvoice).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: "idem-1" }));
	});

	it("clears a reserved queued sale without trying to print the draft", async () => {
		const renderInvoice = vi.fn();
		const result = await useCartStore.getState().submitCart(
			[{ mode_of_payment: "Cash", amount: 100 }],
			null,
			"idem-queued",
			makeApi({
				getItemDetails: vi.fn().mockResolvedValue(makeItem({ actual_qty: 4 })),
				createAndSubmitInvoice: vi.fn().mockResolvedValue({
					doctype: "Sales Invoice",
					name: "ACC-SINV-QUEUED-1",
					docstatus: 0,
					queue_status: "Queued",
					items: [],
					totals: {},
				}),
				renderInvoice,
			}),
			true,
		);

		expect(result?.invoice.queue_status).toBe("Queued");
		expect(result?.printPayload).toBeNull();
		expect(renderInvoice).not.toHaveBeenCalled();
		expect(useCartStore.getState().invoice).toBeNull();
	});

	it("passes the selected credit-sale state to direct server checkout", async () => {
		const createAndSubmitInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice", name: "ACC-SINV-CREDIT-1", docstatus: 1, items: [], totals: {},
		});

		await useCartStore.getState().submitCart(
			[], null, "idem-credit", makeApi({
				getItemDetails: vi.fn().mockResolvedValue(makeItem()),
				createAndSubmitInvoice,
				renderInvoice: vi.fn().mockRejectedValue(new Error("no print")),
			}), true, true, "2026-08-28",
		);

		expect(createAndSubmitInvoice).toHaveBeenCalledWith(expect.objectContaining({
			idempotency_key: "idem-credit",
			is_credit_sale: true,
			due_date: "2026-08-28",
			payments: "[]",
		}));
	});

	it("preserves the cart when direct server submission fails", async () => {
		await expect(
			useCartStore.getState().submitCart(
				[{ mode_of_payment: "Cash", amount: 100 }], null, "idem-1",
				makeApi({
					getItemDetails: vi.fn().mockResolvedValue(makeItem()),
					createAndSubmitInvoice: vi.fn().mockRejectedValue(new Error("Totals do not match")),
				}), true,
			),
		).rejects.toThrow(/Totals do not match/);
		expect(useCartStore.getState().invoice).not.toBeNull();
		expect(useCartStore.getState().error).toMatch(/Totals do not match/);
	});

	it("rejects checkout while offline and preserves the cart", async () => {
		await expect(useCartStore.getState().submitCart(
			[{ mode_of_payment: "Cash", amount: 100 }], null, "idem-offline", makeApi(), false,
		)).rejects.toThrow(/online-only/);
		expect(useCartStore.getState().invoice).not.toBeNull();
	});

	it("refreshes stock before online checkout and preserves a rejected sale", async () => {
		const getItemDetails = vi.fn().mockResolvedValue(
			makeItem({ is_stock_item: 1, actual_qty: 0, allow_negative_stock: 0 }),
		);
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		await useCartStore.getState().addCartItem(
			makeItem({ is_stock_item: 1, actual_qty: 5, allow_negative_stock: 0 }),
			makeApi(),
		);

		await expect(
			useCartStore
				.getState()
				.submitCart(
					[{ mode_of_payment: "Cash", amount: 100 }],
					null,
					"idem-stock",
					makeApi({ getItemDetails }),
					true,
				),
		).rejects.toThrow(/Available quantity is 0/);

		expect(getItemDetails).toHaveBeenCalledWith({
			item_code: "ITEM-1",
			pos_profile: "Profile-1",
			customer: "CUST-1",
		});
		expect(useCartStore.getState().invoice).not.toBeNull();
	});

	it("checks out a held/source-tracked invoice through the server", async () => {
		useCartStore.setState({
			invoice: {
				doctype: "Sales Invoice",
				name: "SINV-0005",
				docstatus: 0,
				is_local: false,
				items: [{ row_name: "r1", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
				totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
			},
		});
		const checkoutInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice",
			name: "SINV-0005",
			docstatus: 1,
			items: [],
			totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
		});
		const renderInvoice = vi.fn().mockRejectedValue(new Error("print server down"));

		const result = await useCartStore
			.getState()
			.submitCart([{ mode_of_payment: "Cash", amount: 100 }], null, "idem-1", makeApi({ checkoutInvoice, renderInvoice }), true);

		// Render failure on this path is non-fatal - the sale already succeeded server-side.
		expect(result?.invoice.docstatus).toBe(1);
		expect(result?.printPayload).toBeNull();
		expect(useCartStore.getState().invoice).toBeNull();
	});
});

describe("validateCart", () => {
	it("replaces local totals with the server preview before checkout", async () => {
		useCartStore.setState({ defaultCustomer: CUSTOMER });
		await useCartStore.getState().addCartItem(makeItem(), makeApi());
		const previewInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice",
			name: "Not invoiced yet",
			docstatus: 0,
			customer: "CUST-1",
			items: [{ row_name: "server-row", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 125, amount: 125 }],
			taxes: [],
			totals: { net_total: 125, total_taxes_and_charges: 0, grand_total: 125, rounded_total: 125 },
		});

		const validated = await useCartStore.getState().validateCart(makeApi({ previewInvoice }));

		expect(validated?.items[0].rate).toBe(125);
		expect(validated?.totals.grand_total).toBe(125);
		expect(useCartStore.getState().invoice?.totals.grand_total).toBe(125);
		expect(previewInvoice).toHaveBeenCalledWith(expect.objectContaining({
			pos_profile: "Profile-1",
			customer: "CUST-1",
		}));
	});

	it("validates a restored hold using its original server doctype", async () => {
		useCartStore.setState({
			invoice: {
				doctype: "VunaPOS Cart",
				name: "SINV-HELD-1",
				docstatus: 0,
				is_local: true,
				source_invoice_doctype: "Sales Invoice",
				source_invoice_name: "SINV-HELD-1",
				items: [{ row_name: "row-1", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
				totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
			},
		});
		const previewInvoice = vi.fn().mockResolvedValue({
			doctype: "Sales Invoice",
			name: "Not invoiced yet",
			docstatus: 0,
			items: [{ row_name: "server-row", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
			taxes: [],
			totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
		});

		await useCartStore.getState().validateCart(makeApi({ previewInvoice }));

		expect(previewInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoice_doctype: "Sales Invoice" }));
		expect(useCartStore.getState().invoice).toMatchObject({
			doctype: "Sales Invoice",
			is_local: true,
			source_invoice_doctype: "Sales Invoice",
			source_invoice_name: "SINV-HELD-1",
		});
	});
});

describe("holdCart", () => {
	it("returns null for an empty cart", async () => {
		useCartStore.setState({ invoice: null });

		const result = await useCartStore.getState().holdCart(makeApi());

		expect(result).toBeNull();
	});

	describe("brand-new local cart", () => {
		beforeEach(async () => {
			await db.items.put({ item_code: "ITEM-1", item_name: "Widget", rate: 100, modified: "2026-07-10" });
			useCartStore.setState({ defaultCustomer: CUSTOMER });
			await useCartStore.getState().addCartItem(makeItem(), makeApi());
		});

		it("creates and holds a server draft directly", async () => {
			const draft = { doctype: "Sales Invoice", name: "ACC-SINV-DRAFT-1", docstatus: 0, items: [], totals: {} };
			const held = { ...draft, name: "ACC-SINV-HELD-1" };
			const createInvoiceFromCart = vi.fn().mockResolvedValue(draft);
			const holdInvoice = vi.fn().mockResolvedValue(held);
			const listHeldInvoices = vi.fn().mockResolvedValue([]);
			const result = await useCartStore.getState().holdCart(makeApi({ createInvoiceFromCart, holdInvoice, listHeldInvoices }));
			expect(result?.name).toBe("ACC-SINV-HELD-1");
			expect(result?.docstatus).toBe(0);
			expect(useCartStore.getState().invoice).toBeNull();
			expect(createInvoiceFromCart).toHaveBeenCalledOnce();
			expect(holdInvoice).toHaveBeenCalledOnce();
		});

		it("persists an applied loyalty redemption on the held draft", async () => {
			const invoice = useCartStore.getState().invoice!;
			useCartStore.setState({ invoice: { ...invoice, loyalty_points: 15, loyalty_amount: 10 } });
			const draft = { doctype: "Sales Invoice", name: "ACC-SINV-DRAFT-LOYALTY", docstatus: 0, items: [], totals: {} };
			const createInvoiceFromCart = vi.fn().mockResolvedValue(draft);
			const holdInvoice = vi.fn().mockResolvedValue({ ...draft, is_held: true });

			await useCartStore.getState().holdCart(makeApi({
				createInvoiceFromCart,
				holdInvoice,
				listHeldInvoices: vi.fn().mockResolvedValue([]),
			}));

			expect(createInvoiceFromCart).toHaveBeenCalledWith(expect.objectContaining({ loyalty_points: 15 }));
		});

		it("preserves the cart when server draft creation fails", async () => {
			await expect(useCartStore.getState().holdCart(makeApi({
				createInvoiceFromCart: vi.fn().mockRejectedValue(new Error("Server unavailable")),
			}))).rejects.toThrow(/Server unavailable/);
			expect(useCartStore.getState().invoice).not.toBeNull();
		});

		it("holds a combined batch-and-serial item immediately after serial selection", async () => {
			const invoice = useCartStore.getState().invoice!;
			const serialItem = {
				...invoice.items[0],
				item_code: "SERIAL-BATCH-1",
				item_name: "Batched and Serialed 1",
				has_batch_no: 1,
				has_serial_no: 1,
				actual_qty: 1,
			};
			useCartStore.setState({ invoice: { ...invoice, items: [serialItem] } });
			const serial = { serial_no: "SERIAL-0001", batch_no: "BATCH-0001" };

			const saving = useCartStore.getState().updateCartItemSerialAllocations(
				serialItem.row_name,
				[serial],
				makeApi(),
			);
			const draft = { doctype: "Sales Invoice", name: "ACC-SINV-DRAFT-1", docstatus: 0, items: [], totals: {} };
			const held = { ...draft, name: "ACC-SINV-HELD-1", is_held: true };
			const createInvoiceFromCart = vi.fn().mockResolvedValue(draft);
			const holdInvoice = vi.fn().mockResolvedValue(held);
			const listHeldInvoices = vi.fn().mockResolvedValue([]);

			const result = await useCartStore.getState().holdCart(makeApi({
				createInvoiceFromCart,
				holdInvoice,
				listHeldInvoices,
			}));
			await saving;

			const payload = createInvoiceFromCart.mock.calls[0][0] as { items: string };
			expect(JSON.parse(payload.items)[0].serial_allocations).toEqual([serial]);
			expect(result?.name).toBe("ACC-SINV-HELD-1");
			expect(useCartStore.getState().invoice).toBeNull();
		});
	});

	it("holds an already server-tracked invoice via the server directly (unchanged, online-only)", async () => {
		useCartStore.setState({
			invoice: {
				doctype: "Sales Invoice",
				name: "SINV-0005",
				docstatus: 0,
				is_local: false,
				items: [{ row_name: "r1", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
				totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
			},
		});
		const held: HeldInvoiceDTO = { doctype: "Sales Invoice", name: "SINV-0005" };
		const holdInvoice = vi.fn().mockResolvedValue(held);
		const listHeldInvoices = vi.fn().mockResolvedValue([held]);

		const result = await useCartStore.getState().holdCart(makeApi({ holdInvoice, listHeldInvoices }));

		expect(holdInvoice).toHaveBeenCalledWith(
			expect.objectContaining({ invoice_doctype: "Sales Invoice", invoice_name: "SINV-0005" }),
		);
		expect(result?.name).toBe("SINV-0005");
		expect(useCartStore.getState().invoice).toBeNull();
		expect(useCartStore.getState().heldInvoices).toEqual([held]);
	});
});

describe("restoreHeldInvoice", () => {
	it("restores a held invoice into a local, editable cart and refreshes the held list", async () => {
		const held: HeldInvoiceDTO = {
			doctype: "Sales Invoice",
			name: "SINV-0007",
			customer: "CUST-1",
			grand_total: 100,
		};
		const restored: InvoiceDTO = {
			doctype: held.doctype,
			name: held.name,
			docstatus: 0,
			customer: held.customer,
			items: [{ row_name: "r1", item_code: "ITEM-1", item_name: "Widget", qty: 1, rate: 100, amount: 100 }],
			totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
		};
		const restoreInvoice = vi.fn().mockResolvedValue(restored);
		const listHeldInvoices = vi.fn().mockResolvedValue([]);

		const result = await useCartStore.getState().restoreHeldInvoice(held, makeApi({ restoreInvoice, listHeldInvoices }));

		expect(result.name).toBe("SINV-0007");
		expect(useCartStore.getState().invoice?.is_local).toBe(true);
		expect(useCartStore.getState().invoice?.source_invoice_name).toBe("SINV-0007");
		expect(listHeldInvoices).toHaveBeenCalled();
	});

	// Bug report: restoring a held taxed cart lost its tax, so the pre-filled payment
	// no longer matched the server total and checkout failed. Root cause:
	// invoiceToLocalCart rebuilt totals via buildLocalCart, which hardcoded
	// total_taxes_and_charges to 0 instead of preserving the server-computed totals.
	it("preserves the real (taxed) totals from the server when restoring a held invoice, not a recomputed zero-tax total", async () => {
		const held: HeldInvoiceDTO = {
			doctype: "Sales Invoice",
			name: "SINV-0008",
			customer: "CUST-1",
			grand_total: 1392,
		};
		const restored: InvoiceDTO = {
			doctype: held.doctype,
			name: held.name,
			docstatus: 0,
			customer: held.customer,
			items: [
				{ row_name: "r1", item_code: "ITEM-TAXED", item_name: "Taxed Widget", qty: 1, rate: 1200, amount: 1200 },
			],
			taxes: [
				{ account_head: "VAT - TC", rate: 16, tax_amount: 192, total: 1392, included_in_print_rate: false },
			],
			totals: { net_total: 1200, total_taxes_and_charges: 192, grand_total: 1392, rounded_total: 1392 },
		};
		const restoreInvoice = vi.fn().mockResolvedValue(restored);
		const listHeldInvoices = vi.fn().mockResolvedValue([]);

		await useCartStore.getState().restoreHeldInvoice(held, makeApi({ restoreInvoice, listHeldInvoices }));

		const invoice = useCartStore.getState().invoice;
		expect(invoice?.totals.total_taxes_and_charges).toBeCloseTo(192, 2);
		expect(invoice?.totals.grand_total).toBeCloseTo(1392, 2);
		expect(invoice?.taxes?.[0]?.account_head).toBe("VAT - TC");
	});
});
