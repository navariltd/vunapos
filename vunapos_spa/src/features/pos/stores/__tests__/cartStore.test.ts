import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../../../lib/db";
import { META_KEYS } from "../../../../lib/repositories/metaRepository";
import type { CustomerDTO, HeldInvoiceDTO, InvoiceDTO, ItemDTO } from "../../types";
import { getActiveCustomer, useCartStore, type CartApi } from "../cartStore";

function makeApi(overrides: Partial<CartApi> = {}): CartApi {
	const reject = vi.fn().mockRejectedValue(new Error("unexpected API call in this test"));
	return {
		addItem: reject,
		getItemDetails: reject,
		getItemBatches: reject,
		updateItem: reject,
		removeItem: reject,
		clearInvoice: reject,
		createInvoiceFromCart: reject,
		previewInvoice: reject,
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
	await Promise.all([
		db.items.clear(),
		db.batchInventory.clear(),
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
				getItemDetails: vi.fn().mockResolvedValue(makeItem()), createAndSubmitInvoice, renderInvoice,
			}), true);

		expect(result?.invoice.name).toBe("ACC-SINV-0001");
		expect(result?.invoice.docstatus).toBe(1);
		expect(result?.printPayload?.html).toContain("receipt");
		expect(useCartStore.getState().invoice).toBeNull();
		expect(createAndSubmitInvoice).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: "idem-1" }));
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

		it("preserves the cart when server draft creation fails", async () => {
			await expect(useCartStore.getState().holdCart(makeApi({
				createInvoiceFromCart: vi.fn().mockRejectedValue(new Error("Server unavailable")),
			}))).rejects.toThrow(/Server unavailable/);
			expect(useCartStore.getState().invoice).not.toBeNull();
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
