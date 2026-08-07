import { create } from "zustand";

import type {
	CustomerDTO,
	HeldInvoiceDTO,
	InvoiceDTO,
	InvoiceItemDTO,
	ItemBatchesDTO,
	ItemDTO,
	PaymentInput,
	PrintPayload,
} from "../types";
import { assembleInvoice, type AssembledInvoice, type ItemTaxRow } from "../../../lib/invoiceEngine";
import { itemTaxTemplateRepository } from "../../../lib/repositories/itemTaxTemplateRepository";
import { itemRepository } from "../../../lib/repositories/itemRepository";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import { taxTemplateRepository } from "../../../lib/repositories/taxTemplateRepository";
import { resolveTaxSettings } from "../../../lib/taxSettings";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";
import {
	addItem,
	checkoutInvoice,
	clearInvoice,
	createAndSubmitInvoice,
	createAndSubmitSalesOrder,
	createInvoiceFromCart,
	getItemBatches,
	getItemDetails,
	resolveBarcode,
	searchItems,
	holdInvoice,
	listHeldInvoices,
	previewInvoice,
	removeItem,
	renderInvoice,
	restoreInvoice,
	updateInvoiceFromCart,
	updateItem,
	type FrappeCall,
} from "../../../services/vunaApi";

// Mutating actions take a CartApi of plain functions as their last argument instead of
// calling useFrappePostCall directly (that hook must run inside a component) - keeps
// this store's business logic testable with zero React/SDK involvement.
export type CartApi = {
	addItem: FrappeCall;
	getItemDetails: FrappeCall;
	searchItems: FrappeCall;
	resolveBarcode: FrappeCall;
	getItemBatches: FrappeCall;
	updateItem: FrappeCall;
	removeItem: FrappeCall;
	clearInvoice: FrappeCall;
	createInvoiceFromCart: FrappeCall;
	previewInvoice: FrappeCall;
	createAndSubmitInvoice: FrappeCall;
	createAndSubmitSalesOrder: FrappeCall;
	checkoutInvoice: FrappeCall;
	holdInvoice: FrappeCall;
	listHeldInvoices: FrappeCall;
	restoreInvoice: FrappeCall;
	updateInvoiceFromCart: FrappeCall;
	renderInvoice: FrappeCall;
};

// ---- pure helpers (ported unchanged from the old usePOSInvoice.ts - zero window/React dependency) ----

function isLocalCart(invoice?: InvoiceDTO | null) {
	return Boolean(invoice?.is_local);
}

// A brand-new local cart that has not yet been materialized as a server draft.
export function isUnsyncedLocalCart(invoice?: InvoiceDTO | null): boolean {
	return isLocalCart(invoice) && !invoice?.source_invoice_doctype;
}

function getLocalCartSource(invoice?: InvoiceDTO | null) {
	if (!invoice?.source_invoice_doctype || !invoice.source_invoice_name) {
		return undefined;
	}

	return {
		doctype: invoice.source_invoice_doctype,
		name: invoice.source_invoice_name,
	};
}

function cartItemPayload(item: InvoiceItemDTO) {
	return {
		item_code: item.item_code,
		qty: item.qty,
		uom: item.uom,
		conversion_factor: item.conversion_factor,
		batch_allocations: item.batch_allocations?.map((allocation) => ({
			batch_no: allocation.batch_no,
			qty: allocation.qty,
		})),
		serial_allocations: item.serial_allocations,
		item_note: item.item_note,
		pricing_override: item.pricing_override,
	};
}

function cartItemsPayload(items: InvoiceItemDTO[]) {
	return items.filter((item) => !item.is_free_item).map(cartItemPayload);
}

function validateManualBatchAllocations(items: InvoiceItemDTO[]) {
	for (const item of items) {
		if (item.has_serial_no) {
			const required = item.qty * Number(item.conversion_factor || 1);
			const serials = item.serial_allocations || [];
			if (!Number.isInteger(required) || required <= 0) {
				throw new Error(`${item.item_name} requires a whole-number stock quantity for serial selection.`);
			}
			// An empty selection delegates to ERPNext's configured automatic outward
			// bundle allocation. A partially entered manual selection must still be complete.
			if (!serials.length) continue;
			if (serials.length !== required || new Set(serials.map((row) => row.serial_no)).size !== required) {
				throw new Error(`Select exactly ${required} unique serial numbers for ${item.item_name}.`);
			}
			continue;
		}
		const allocations = item.batch_allocations || [];
		if (!allocations.length) continue;
		const batchNumbers = new Set<string>();
		let allocated = 0;
		for (const allocation of allocations) {
			if (!allocation.batch_no || !Number.isFinite(allocation.qty) || allocation.qty <= 0) {
				throw new Error(`Invalid batch allocation for ${item.item_name}.`);
			}
			if (batchNumbers.has(allocation.batch_no)) {
				throw new Error(`Batch ${allocation.batch_no} is allocated more than once for ${item.item_name}.`);
			}
			batchNumbers.add(allocation.batch_no);
			allocated += allocation.qty;
		}
		const stockQty = item.qty * Number(item.conversion_factor || 1);
		if (Math.abs(allocated - stockQty) > 0.000001) {
			throw new Error(`Batch allocation for ${item.item_name} must equal the quantity of ${stockQty} stock units.`);
		}
	}
}

function clearIncompleteSerialAllocation(item: InvoiceItemDTO): InvoiceItemDTO {
	if (!item.has_serial_no || !item.serial_allocations?.length) return item;
	const required = item.qty * Number(item.conversion_factor || 1);
	const uniqueSerials = new Set(item.serial_allocations.map((row) => row.serial_no));
	if (
		Number.isInteger(required)
		&& item.serial_allocations.length === required
		&& uniqueSerials.size === required
	) {
		return item;
	}
	return {
		...item,
		batch_no: null,
		serial_and_batch_bundle: null,
		batch_allocations: [],
		serial_allocations: [],
	};
}

// Converts a held draft being restored into the local-cart shape for editing. Must NOT
// zero/recompute totals here: they stay ground truth until the cashier edits the cart
// (previewLocalCart then recomputes). CheckoutDialog pre-fills the payment amount from
// this total, so dropping tax here would make the payment fall short and checkout fail
// with a totals mismatch.
function invoiceToLocalCart(invoice: InvoiceDTO): InvoiceDTO {
	return {
		...invoice,
		doctype: "VunaPOS Cart",
		is_local: true,
		source_invoice_doctype: invoice.doctype,
		source_invoice_name: invoice.name,
		items: invoice.items.map((item) => ({
			...item,
			pricing_override: item.pricing_override ?? pricingOverrideFromSavedItem(item),
		})),
	};
}

function pricingOverrideFromSavedItem(item: InvoiceItemDTO): InvoiceItemDTO["pricing_override"] {
	if (Number(item.discount_percentage || 0) > 0) {
		return { type: "discount_percentage", value: Number(item.discount_percentage) };
	}
	if (Number(item.discount_amount || 0) > 0) {
		return { type: "discount_amount", value: Number(item.discount_amount) };
	}
	if (item.price_list_rate != null && Number(item.rate) !== Number(item.price_list_rate)) {
		return { type: "rate", value: Number(item.rate) };
	}
	return undefined;
}

function preservePricingOverrides(invoice: InvoiceDTO, sourceItems: InvoiceItemDTO[]): InvoiceDTO {
	const sourceByCode = new Map(sourceItems.map((item) => [item.item_code, item]));
	return {
		...invoice,
		items: invoice.items.map((item) => {
			const source = sourceByCode.get(item.item_code);
			return {
				...item,
				uoms: source?.uoms || item.uoms,
				barcode: source?.barcode || item.barcode,
				item_tax: source?.item_tax ?? item.item_tax,
				item_note: source?.item_note ?? item.item_note,
				pricing_rules: source?.pricing_rules ?? item.pricing_rules,
				pricing_override_audit: source?.pricing_override_audit ?? item.pricing_override_audit,
				pricing_override_by: source?.pricing_override_by ?? item.pricing_override_by,
				pricing_override: source?.pricing_override ?? pricingOverrideFromSavedItem(item),
			};
		}),
	};
}

function localizePreviewInvoice(
	preview: InvoiceDTO,
	localItems: InvoiceItemDTO[],
	selectedCustomer?: CustomerDTO | null,
	sourceInvoice?: Pick<InvoiceDTO, "doctype" | "name">,
) {
	const metadataFor = (item: InvoiceItemDTO) => localItems.find((candidate) =>
		candidate.item_code === item.item_code
		&& (candidate.uom || candidate.stock_uom) === (item.uom || item.stock_uom)
		&& Number(candidate.conversion_factor || 1) === Number(item.conversion_factor || 1),
	) || localItems.find((candidate) => candidate.item_code === item.item_code);
	return {
		...preview,
		name: sourceInvoice?.name || "Not invoiced yet",
		is_local: true,
		source_invoice_doctype: sourceInvoice?.doctype,
		source_invoice_name: sourceInvoice?.name,
		customer: selectedCustomer?.customer || preview.customer,
		customer_name: selectedCustomer?.customer_name || preview.customer_name,
		items: preview.items.map((item) => {
			const metadata = metadataFor(item);
			return {
				...item,
				row_name: item.row_name || metadata?.row_name || item.item_code,
				actual_qty: metadata?.actual_qty,
				is_stock_item: metadata?.is_stock_item,
				allow_negative_stock: metadata?.allow_negative_stock,
				has_batch_no: metadata?.has_batch_no,
				has_serial_no: metadata?.has_serial_no,
				warehouse: metadata?.warehouse,
				item_tax: metadata?.item_tax,
			};
		}),
	};
}

// Display metadata (item_name, description, uom) is merged back from sourceItems since
// the Invoice Engine's own output only carries item_code/qty/rate/amount.
function assembledToInvoiceDTO(
	assembled: AssembledInvoice,
	sourceItems: InvoiceItemDTO[],
	sourceInvoice?: Pick<InvoiceDTO, "doctype" | "name">,
): InvoiceDTO {
	const metadataFor = (item: AssembledInvoice["items"][number]) => sourceItems.find((candidate) =>
		candidate.item_code === item.item_code
		&& (candidate.uom || candidate.stock_uom) === (item.uom || candidate.stock_uom)
		&& Number(candidate.conversion_factor || 1) === Number(item.conversion_factor || 1),
	) || sourceItems.find((candidate) => candidate.item_code === item.item_code);
	return {
		doctype: sourceInvoice?.doctype || "Sales Invoice",
		name: sourceInvoice?.name || "Not invoiced yet",
		docstatus: 0,
		items: assembled.items.map((item) => {
			const meta = metadataFor(item);
			return {
				row_name: meta?.row_name || item.item_code,
				item_code: item.item_code,
				item_name: meta?.item_name || item.item_code,
				description: meta?.description,
				qty: item.qty,
				uom: item.uom || meta?.uom,
				stock_uom: meta?.stock_uom,
				conversion_factor: item.conversion_factor || meta?.conversion_factor,
				uoms: meta?.uoms,
				rate: item.rate,
				price_list_rate: meta?.price_list_rate ?? meta?.rate ?? item.rate,
				discount_percentage: item.discount_percentage,
				discount_amount: item.discount_amount,
				amount: item.amount,
				actual_qty: meta?.actual_qty,
				is_stock_item: meta?.is_stock_item,
				allow_negative_stock: meta?.allow_negative_stock,
				has_batch_no: meta?.has_batch_no,
				has_serial_no: meta?.has_serial_no,
				warehouse: meta?.warehouse,
				batch_no: meta?.batch_no,
				serial_and_batch_bundle: meta?.serial_and_batch_bundle,
				batch_allocations: meta?.batch_allocations,
				serial_allocations: meta?.serial_allocations,
				barcode: meta?.barcode,
				item_note: meta?.item_note,
				pricing_rules: meta?.pricing_rules,
				catalogue_pricing_rule: meta?.catalogue_pricing_rule,
				pricing_override_audit: meta?.pricing_override_audit,
				pricing_override_by: meta?.pricing_override_by,
				pricing_override: item.pricing_override ?? meta?.pricing_override,
				// Required: the next previewLocalCart round-trip reads item_tax_template back
				// off this output as its source items - omitting it silently zeroes item tax.
				item_tax_template: meta?.item_tax_template,
				item_tax: meta?.item_tax,
			};
		}),
		taxes: assembled.taxes.map((row) => ({
			account_head: row.account_head,
			description: row.description,
			charge_type: row.charge_type,
			rate: row.rate,
			tax_amount: row.tax_amount,
			total: row.total,
			included_in_print_rate: row.included_in_print_rate,
		})),
		totals: {
			net_total: assembled.totals.net_total,
			total_taxes_and_charges: assembled.totals.total_taxes_and_charges,
			grand_total: assembled.totals.grand_total,
			rounded_total: assembled.totals.rounded_total,
		},
	};
}

async function assembleLocalCart(items: InvoiceItemDTO[]): Promise<AssembledInvoice> {
	const profile = await profileRepository.getActive();
	const taxTemplate = profile?.taxes_and_charges
		? await taxTemplateRepository.getByName(profile.taxes_and_charges)
		: undefined;

	const itemTaxTemplateByCode = new Map(
		items.filter((row) => row.item_tax_template).map((row) => [row.item_code, row.item_tax_template as string]),
	);
	const itemTaxRowsByTemplate = new Map<string, ItemTaxRow[]>();
	for (const templateName of new Set(itemTaxTemplateByCode.values())) {
		const template = await itemTaxTemplateRepository.getByName(templateName);
		if (template) {
			itemTaxRowsByTemplate.set(templateName, template.taxes);
		}
	}

	const taxSettings = await resolveTaxSettings();
	const profileTaxByAccount = new Map(
		(taxTemplate?.taxes ?? []).map((row) => [row.account_head, row]),
	);
	// Every override replaces the previous one. Never use the already-discounted
	// selling rate as the base or sequential edits will compound discounts.
	const rateByLine = new Map(items.map((row) => [
		`${row.item_code}::${row.uom || row.stock_uom || ""}::${Number(row.conversion_factor || 1)}`,
		Number(
			row.catalogue_pricing_rule?.preview_qty === row.qty
				? row.catalogue_pricing_rule.rate
				: row.price_list_rate ?? row.rate ?? 0,
		),
	]));
	return assembleInvoice({
		cart: items.map((row) => ({
			item_code: row.item_code,
			qty: row.qty,
			uom: row.uom,
			conversion_factor: row.conversion_factor,
			pricing_override: row.pricing_override,
		})),
		priceResolver: (code, line) => rateByLine.get(
			`${code}::${line?.uom || ""}::${Number(line?.conversion_factor || 1)}`,
		),
		taxRows: taxTemplate?.taxes ?? [],
		itemTaxResolver: (code) => {
			const templateName = itemTaxTemplateByCode.get(code);
			return templateName
				? itemTaxRowsByTemplate.get(templateName)?.map((row) => ({
					...row,
					included_in_print_rate: profileTaxByAccount.has(row.account_head)
						? Boolean(profileTaxByAccount.get(row.account_head)?.included_in_print_rate)
						: Boolean(profile?.item_prices_include_tax),
				}))
				: undefined;
		},
		taxSettings,
		roundingSettings: profile ? {
			currencyPrecision: profile.currency_precision,
			disableRoundedTotal: profile.disable_rounded_total,
			smallestCurrencyFractionValue: profile.smallest_currency_fraction_value,
			roundingMethod: profile.rounding_method,
		} : undefined,
	});
}

function itemToCartRow(item: ItemDTO, qty = 1): InvoiceItemDTO {
	const rate = Number(item.rate || 0);
	const tracking = item.scan_tracking;
	const conversionFactor = Number(item.conversion_factor || 1);
	return {
		row_name: item.item_code,
		item_code: item.item_code,
		item_name: item.item_name,
		description: item.description,
		qty,
		uom: item.uom || item.stock_uom,
		stock_uom: item.stock_uom,
		conversion_factor: conversionFactor,
		uoms: item.uoms,
		rate,
		price_list_rate: Number(item.price_list_rate ?? rate),
		amount: rate * qty,
		actual_qty: item.actual_qty,
		is_stock_item: item.is_stock_item,
		allow_negative_stock: item.allow_negative_stock,
		has_batch_no: item.has_batch_no,
		has_serial_no: item.has_serial_no,
		barcode: item.barcode,
		batch_allocations: tracking?.type === "batch" && tracking.batch_no
			? [{ batch_no: tracking.batch_no, qty: qty * conversionFactor, available_qty: tracking.available_qty }]
			: [],
		serial_allocations: tracking?.type === "serial" && tracking.serial_no
			? [{ serial_no: tracking.serial_no, batch_no: tracking.batch_no ?? null }]
			: [],
		item_tax_template: item.item_tax_template,
		item_tax: item.item_tax,
		catalogue_pricing_rule: item.pricing_rule,
	};
}

function mergeScannedTracking(row: InvoiceItemDTO, item: ItemDTO): InvoiceItemDTO {
	const tracking = item.scan_tracking;
	if (!tracking) return updateLocalQty(row, row.qty + 1);
	const qty = row.qty + 1;
	if (tracking.type === "serial" && tracking.serial_no) {
		if (row.serial_allocations?.some((allocation) => allocation.serial_no === tracking.serial_no)) {
			throw new Error(`Serial number ${tracking.serial_no} has already been scanned.`);
		}
		return {
			...row,
			qty,
			amount: Number(row.rate || 0) * qty,
			serial_allocations: [...(row.serial_allocations || []), {
				serial_no: tracking.serial_no,
				batch_no: tracking.batch_no,
			}],
		};
	}
	if (tracking.type === "batch" && tracking.batch_no) {
		const allocations = [...(row.batch_allocations || [])];
		const existing = allocations.find((allocation) => allocation.batch_no === tracking.batch_no);
		const conversionFactor = Number(item.conversion_factor || 1);
		if (existing) existing.qty += conversionFactor;
		else allocations.push({ batch_no: tracking.batch_no, qty: conversionFactor, available_qty: tracking.available_qty });
		return { ...row, qty, amount: Number(row.rate || 0) * qty, batch_allocations: allocations };
	}
	return updateLocalQty(row, qty);
}

function updateLocalQty(row: InvoiceItemDTO, qty: number): InvoiceItemDTO {
	return {
		...row,
		qty,
		amount: Number(row.rate || 0) * qty,
		...(qty !== row.qty ? {
			// Batch and serial allocations describe an exact stock quantity. Once that
			// quantity changes, retaining an old partial selection prevents the server
			// from applying its configured automatic outward allocation.
			batch_no: null,
			serial_and_batch_bundle: null,
			batch_allocations: [],
			serial_allocations: [],
		} : {}),
	};
}

function allowsNegativeStock(item: ItemDTO | InvoiceItemDTO) {
	return Boolean(item.allow_negative_stock);
}

function isStockControlled(item: ItemDTO) {
	return item.is_stock_item === undefined || Boolean(item.is_stock_item);
}

function validateAvailableQty(item: ItemDTO | InvoiceItemDTO, qty: number) {
	if ("is_stock_item" in item && item.is_stock_item !== undefined && !item.is_stock_item) {
		return;
	}

	if (allowsNegativeStock(item) || item.actual_qty === undefined || item.actual_qty === null) {
		return;
	}

	const stockQty = qty * Number(("conversion_factor" in item && item.conversion_factor) || 1);
	if (stockQty > Number(item.actual_qty || 0)) {
		throw new Error(`Insufficient stock for ${item.item_name}. Available quantity is ${item.actual_qty}.`);
	}
}

async function refreshAndValidateStock(
	invoice: InvoiceDTO,
	posProfile: string | undefined,
	customer: string | undefined,
	priceList: string | undefined,
	api: CartApi,
): Promise<InvoiceDTO> {
	const requestedByCode = new Map<string, number>();
	for (const item of invoice.items) {
		requestedByCode.set(item.item_code, (requestedByCode.get(item.item_code) || 0) + item.qty * Number(item.conversion_factor || 1));
	}

	const freshByCode = new Map<string, ItemDTO>();
	await Promise.all(
		Array.from(requestedByCode).map(async ([itemCode, qty]) => {
			const fresh = await getItemDetails(api.getItemDetails, {
				item_code: itemCode,
				pos_profile: posProfile,
				customer,
				price_list: priceList,
			});
			validateAvailableQty(fresh, qty);
			freshByCode.set(itemCode, fresh);
		}),
	);

	return {
		...invoice,
		items: invoice.items.map((item) => {
			const fresh = freshByCode.get(item.item_code);
			return fresh
				? {
					...item,
					actual_qty: fresh.actual_qty,
					allow_negative_stock: fresh.allow_negative_stock,
					is_stock_item: fresh.is_stock_item,
				}
				: item;
		}),
	};
}

async function refreshSoldItemStock(
	items: InvoiceItemDTO[],
	posProfile: string | undefined,
	customer: string | undefined,
	priceList: string | undefined,
	api: CartApi,
): Promise<void> {
	try {
		const itemCodes = [...new Set(items.map((item) => item.item_code))];
		await Promise.all(itemCodes.map(async (itemCode) => {
			const fresh = await getItemDetails(api.getItemDetails, {
				item_code: itemCode,
				pos_profile: posProfile,
				customer,
				price_list: priceList,
			});
			await itemRepository.updateActualQty(itemCode, fresh.actual_qty);
		}));
		useRuntimeCacheStore.getState().touch();
	} catch (error) {
		// The accounting transaction already succeeded. A catalogue refresh failure
		// must not turn a completed sale into a failed checkout or invite a retry.
		console.error("Failed to refresh sold item stock", error);
	}
}

// ---- store ----

export type CartState = {
	invoice: InvoiceDTO | null;
	heldInvoices: HeldInvoiceDTO[];
	isMutating: boolean;
	isHeldLoading: boolean;
	error: string | null;
	posProfile: string | undefined;
	defaultCustomer: CustomerDTO | null;
	// undefined = "use defaultCustomer", null = "explicitly cleared", value = "chosen" -
	// preserved exactly from the old POSHomePage-local tri-state (not redesigned).
	selectedCustomerOverride: CustomerDTO | null | undefined;
	selectedPriceList: string | undefined;
	newItemPosition: "Top" | "Bottom";
};

export function getActiveCustomer(
	state: Pick<CartState, "selectedCustomerOverride" | "defaultCustomer">,
): CustomerDTO | null {
	return state.selectedCustomerOverride === undefined ? state.defaultCustomer : state.selectedCustomerOverride;
}

export type SubmitCartResult = { invoice: InvoiceDTO; printPayload: PrintPayload | null };

type CartActions = {
	setPosProfile: (posProfile: string | undefined) => void;
	setNewItemPosition: (position: "Top" | "Bottom" | undefined) => void;
	setDefaultCustomer: (customer: CustomerDTO | null) => void;
	setSelectedCustomer: (customer: CustomerDTO | null | undefined) => void;
	addCartItem: (item: ItemDTO, api: CartApi) => Promise<void>;
	scanBarcode: (barcode: string, api: CartApi) => Promise<ItemDTO>;
	updateCartItemQty: (rowName: string, qty: number, api: CartApi) => Promise<void>;
	updateCartItemUom: (rowName: string, uom: string, conversionFactor: number, api: CartApi) => Promise<void>;
	updateCartItemSerialAllocations: (rowName: string, allocations: InvoiceItemDTO["serial_allocations"], api: CartApi) => Promise<void>;
	updateCartItemPricing: (rowName: string, pricingOverride: InvoiceItemDTO["pricing_override"], api: CartApi) => Promise<void>;
	updateCartItemNote: (rowName: string, note: string, api: CartApi) => Promise<void>;
	updateCartItemBatchAllocations: (
		rowName: string,
		allocations: InvoiceItemDTO["batch_allocations"],
		api: CartApi,
	) => Promise<void>;
	loadItemBatches: (
		itemCode: string,
		warehouse: string,
		isOnline: boolean,
		api: CartApi,
	) => Promise<ItemBatchesDTO>;
	removeCartItem: (rowName: string, api: CartApi, managerPinToken?: string) => Promise<void>;
	listHeld: (api: CartApi) => Promise<HeldInvoiceDTO[]>;
	/** Unconditional - the confirm-before-clearing dialog is a UI concern that lives
	 * at the call site (POSHomePage), not here (no Node equivalent to window.confirm). */
	clearCart: (api: CartApi) => Promise<void>;
	validateCart: (api: CartApi) => Promise<InvoiceDTO | null>;
	previewLoyaltyRedemption: (loyaltyPoints: number, api: CartApi) => Promise<InvoiceDTO | null>;
	refreshCartConfiguration: (api: CartApi) => Promise<InvoiceDTO | null>;
	refreshCustomerPricing: (customer: CustomerDTO | null | undefined, api: CartApi) => Promise<InvoiceDTO | null>;
	refreshPriceListPricing: (priceList: string | undefined, api: CartApi) => Promise<InvoiceDTO | null>;
	submitCart: (
		payments: PaymentInput[],
		printFormat: string | null | undefined,
		idempotencyKey: string | undefined,
		api: CartApi,
		isOnline?: boolean,
		isCreditSale?: boolean,
		dueDate?: string,
		loyaltyPoints?: number,
		taxId?: string,
		orderType?: "Sales Invoice" | "Sales Order",
		salesperson?: string,
		salespersonToken?: string,
	) => Promise<SubmitCartResult | null>;
	holdCart: (api: CartApi) => Promise<InvoiceDTO | null>;
	restoreHeldInvoice: (heldInvoice: HeldInvoiceDTO, api: CartApi) => Promise<InvoiceDTO>;
};

export type CartStore = CartState & CartActions;

export const useCartStore = create<CartStore>((set, get) => {
	let localAddQueue = Promise.resolve();
	let localCartRevision = 0;
	let localPreviewTimer: ReturnType<typeof setTimeout> | undefined;
	const pricingPreviewCache = new Map<string, { expiresAt: number; invoice: InvoiceDTO }>();
	const previewApiIds = new WeakMap<object, number>();
	let nextPreviewApiId = 1;

	function pricingPreviewKey(items: InvoiceItemDTO[], api: CartApi) {
		const state = get();
		const apiFunction = api.previewInvoice as unknown as object;
		let apiId = previewApiIds.get(apiFunction);
		if (!apiId) {
			apiId = nextPreviewApiId++;
			previewApiIds.set(apiFunction, apiId);
		}
		return JSON.stringify({
			apiId,
			posProfile: state.posProfile,
			customer: getActiveCustomer(state)?.customer,
			priceList: state.selectedPriceList,
			items: cartItemsPayload(items),
		});
	}

	async function runMutation<T>(mutation: () => Promise<T>): Promise<T> {
		set({ isMutating: true, error: null });
		try {
			return await mutation();
		} catch (err) {
			console.error(err);
			set({ error: err instanceof Error ? err.message : "Invoice action failed" });
			throw err;
		} finally {
			set({ isMutating: false });
		}
	}

	async function previewLocalCart(items: InvoiceItemDTO[], currentInvoice?: InvoiceDTO | null): Promise<InvoiceDTO> {
		const sourceInvoice = getLocalCartSource(currentInvoice);
		// Local Invoice Engine, not a server round trip (I3/G3) - pricing/tax feedback
		// while building a cart is instant and works with zero network availability.
		const assembled = await assembleLocalCart(items);
		const preview = assembledToInvoiceDTO(assembled, items, sourceInvoice);
		return localizePreviewInvoice(preview, items, getActiveCustomer(get()), sourceInvoice);
	}

	async function previewCartWithPricingRules(
		items: InvoiceItemDTO[],
		currentInvoice: InvoiceDTO | null | undefined,
		api: CartApi,
	): Promise<InvoiceDTO> {
		const selectedCustomer = getActiveCustomer(get());
		const customer = selectedCustomer?.customer || currentInvoice?.customer;
		if (!customer) {
			return previewLocalCart(items, currentInvoice);
		}
		const sourceInvoice = getLocalCartSource(currentInvoice);
		const authoritative = await previewInvoice(api.previewInvoice, {
			pos_profile: get().posProfile,
			customer,
			invoice_doctype: sourceInvoice?.doctype || currentInvoice?.doctype,
			price_list: get().selectedPriceList || currentInvoice?.selling_price_list,
			items: cartItemsPayload(items),
			loyalty_points: currentInvoice?.loyalty_points || undefined,
		});
		return localizePreviewInvoice(authoritative, items, selectedCustomer, sourceInvoice);
	}

	function scheduleBackgroundPricing(
		nextItems: InvoiceItemDTO[],
		optimistic: InvoiceDTO,
		api: CartApi,
		revision: number,
	) {
		if (!getActiveCustomer(get())) return;
		if (localPreviewTimer) clearTimeout(localPreviewTimer);
		localPreviewTimer = setTimeout(() => {
			const latestInvoice = get().invoice;
			if (revision !== localCartRevision || latestInvoice !== optimistic) return;
			const cacheKey = pricingPreviewKey(nextItems, api);
			const cached = pricingPreviewCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				if (revision === localCartRevision && get().invoice === optimistic) {
					set({ invoice: cached.invoice });
				}
				return;
			}
			void previewCartWithPricingRules(nextItems, optimistic, api)
				.then((authoritative) => {
					pricingPreviewCache.set(cacheKey, {
						expiresAt: Date.now() + 5000,
						invoice: authoritative,
					});
					if (pricingPreviewCache.size > 50) {
						pricingPreviewCache.delete(pricingPreviewCache.keys().next().value as string);
					}
					if (revision === localCartRevision && get().invoice === optimistic) {
						set({ invoice: authoritative });
					}
				})
				.catch((error) => console.error("Unable to refresh cart pricing", error));
		}, 120);
	}

	async function applyOptimisticLocalCart(
		nextItems: InvoiceItemDTO[],
		currentInvoice: InvoiceDTO,
		api: CartApi,
	) {
		// Publish the changed rows before the asynchronous local tax/total pass so
		// serial and batch selections are immediately visible to Hold and Checkout.
		const pendingInvoice = { ...currentInvoice, items: nextItems };
		set({ invoice: pendingInvoice, error: null });
		const optimistic = await previewLocalCart(nextItems, pendingInvoice);
		const revision = ++localCartRevision;
		if (get().invoice === pendingInvoice) set({ invoice: optimistic, error: null });
		scheduleBackgroundPricing(nextItems, optimistic, api, revision);
		return optimistic;
	}

	async function syncLocalCartToSource(cart: InvoiceDTO, api: CartApi) {
		if (!cart.source_invoice_doctype || !cart.source_invoice_name) {
			return null;
		}

		const selectedCustomer = getActiveCustomer(get());
		return updateInvoiceFromCart(api.updateInvoiceFromCart, {
			invoice_doctype: cart.source_invoice_doctype,
			invoice_name: cart.source_invoice_name,
			customer: selectedCustomer?.customer || cart.customer,
			price_list: get().selectedPriceList || cart.selling_price_list,
			items: cartItemsPayload(cart.items),
			loyalty_points: cart.loyalty_points || undefined,
		});
	}

	async function restoreDefaultCataloguePricing(api: CartApi) {
		try {
			const pricedItems = await searchItems(api.searchItems, {
				pos_profile: get().posProfile,
				customer: getActiveCustomer(get())?.customer,
				limit: 100000,
			});
			await itemRepository.replaceAll(pricedItems);
			useRuntimeCacheStore.getState().touch();
		} catch (error) {
			// Do not report a completed transaction as failed if only this refresh fails.
			console.error("Unable to restore the default price list", error);
		}
	}

	return {
		invoice: null,
		heldInvoices: [],
		isMutating: false,
		isHeldLoading: false,
		error: null,
		posProfile: undefined,
		defaultCustomer: null,
		selectedCustomerOverride: undefined,
		selectedPriceList: undefined,
		newItemPosition: "Bottom",

		setPosProfile: (posProfile) => set({ posProfile }),
		setNewItemPosition: (position) => set({ newItemPosition: position === "Top" ? "Top" : "Bottom" }),
		setDefaultCustomer: (defaultCustomer) => set({ defaultCustomer }),
		setSelectedCustomer: (selectedCustomerOverride) => set({ selectedCustomerOverride }),

		addCartItem: async (item, api) => {
			const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
			if (isStockControlled(item)) {
				validateAvailableQty(item, 1);
			}

			const invoice = get().invoice;
			if (!invoice || isLocalCart(invoice) || invoice.docstatus !== 0) {
				// Serialize local additions so rapid clicks cannot read the same stale
				// cart before the previous optimistic update has been applied.
				localAddQueue = localAddQueue.catch(() => undefined).then(async () => {
					const currentInvoice = get().invoice;
					const currentItems = currentInvoice && isLocalCart(currentInvoice) && currentInvoice.docstatus === 0
						? currentInvoice.items
						: [];
					const itemUom = item.uom || item.stock_uom;
					const itemConversionFactor = Number(item.conversion_factor || 1);
					const existingItem = currentItems.find((row) =>
						row.item_code === item.item_code
						&& (row.uom || row.stock_uom) === itemUom
						&& Number(row.conversion_factor || 1) === itemConversionFactor,
					);
					const nextItems = existingItem
						? currentItems.map((row) => {
							if (
								row.item_code === item.item_code
								&& (row.uom || row.stock_uom) === itemUom
								&& Number(row.conversion_factor || 1) === itemConversionFactor
							) {
								validateAvailableQty(row, row.qty + 1);
								return mergeScannedTracking(row, item);
							}
							return row;
						})
						: get().newItemPosition === "Top"
							? [itemToCartRow(item), ...currentItems]
							: [...currentItems, itemToCartRow(item)];

					await applyOptimisticLocalCart(nextItems, currentInvoice, api);
				}).catch((error) => {
					set({ error: error instanceof Error ? error.message : "Failed to add item" });
					throw error;
				});
				await localAddQueue;
				if (import.meta.env.DEV && startedAt) {
					console.debug("[VunaPOS] item added", {
						itemCode: item.item_code,
						milliseconds: Math.round(performance.now() - startedAt),
					});
				}
				return;
			}

			const updatedInvoice = await runMutation(() =>
				addItem(api.addItem, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					item_code: item.item_code,
					qty: 1,
				}),
			);
			set({ invoice: updatedInvoice });
		},

		scanBarcode: async (barcode, api) => {
			const value = barcode.trim();
			if (!value) throw new Error("A barcode is required.");
			const state = get();
			const customer = getActiveCustomer(state);
			const item = await runMutation(() => resolveBarcode(api.resolveBarcode, {
				barcode: value,
				pos_profile: state.posProfile,
				customer: customer?.customer,
				price_list: state.selectedPriceList,
			}));
			await get().addCartItem(item, api);
			return item;
		},

		updateCartItemQty: async (rowName, qty, api) => {
			const invoice = get().invoice;
			if (!invoice) {
				return;
			}

			if (isLocalCart(invoice)) {
				const nextItems =
					qty <= 0
						? invoice.items.filter((row) => row.row_name !== rowName)
						: invoice.items.map((row) => {
							if (row.row_name === rowName) {
								validateAvailableQty(row, qty);
								return updateLocalQty(row, qty);
							}
							return row;
						});
				if (!nextItems.length) {
					set({ invoice: null });
					return;
				}
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}

			if (qty <= 0) {
				const updatedInvoice = await runMutation(() =>
					removeItem(api.removeItem, {
						invoice_doctype: invoice.doctype,
						invoice_name: invoice.name,
						row_name: rowName,
					}),
				);
				set({ invoice: updatedInvoice });
				return;
			}

			const updatedInvoice = await runMutation(() =>
				updateItem(api.updateItem, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					row_name: rowName,
					qty,
				}),
			);
			set({ invoice: updatedInvoice });
		},

		updateCartItemPricing: async (rowName, pricingOverride, api) => {
			const invoice = get().invoice;
			if (!invoice) return;
			const nextItems = invoice.items.map((item) =>
				item.row_name === rowName ? { ...item, pricing_override: pricingOverride } : item,
			);
			const profile = await profileRepository.getActive();
			if (pricingOverride?.type === "rate" && !profile?.allow_rate_change) {
				throw new Error("Rate changes are not allowed for this POS Profile.");
			}
			if (pricingOverride?.type.startsWith("discount") && !profile?.allow_discount_change) {
				throw new Error("Discount changes are not allowed for this POS Profile.");
			}
			if (isLocalCart(invoice)) {
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}
			const updatedInvoice = await runMutation(() =>
				updateInvoiceFromCart(api.updateInvoiceFromCart, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					customer: invoice.customer,
					price_list: get().selectedPriceList || invoice.selling_price_list,
					items: cartItemsPayload(nextItems),
				}),
			);
			set({ invoice: preservePricingOverrides(updatedInvoice, nextItems) });
		},

		updateCartItemNote: async (rowName, note, api) => {
			const invoice = get().invoice;
			if (!invoice) return;
			const cleanNote = note.trim();
			if (cleanNote.length > 500) throw new Error("Item notes cannot exceed 500 characters.");
			const nextItems = invoice.items.map((item) =>
				item.row_name === rowName ? { ...item, item_note: cleanNote || null } : item,
			);
			if (isLocalCart(invoice)) {
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}
			const updated = await runMutation(() => updateInvoiceFromCart(api.updateInvoiceFromCart, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					customer: invoice.customer,
					price_list: get().selectedPriceList || invoice.selling_price_list,
					items: cartItemsPayload(nextItems),
				}));
			set({ invoice: preservePricingOverrides(updated, nextItems) });
		},

		updateCartItemUom: async (rowName, uom, conversionFactor, api) => {
			const invoice = get().invoice;
			if (!invoice || !(conversionFactor > 0)) return;
			const nextItems = invoice.items.map((item) => {
				if (item.row_name !== rowName) return item;
				const oldFactor = Number(item.conversion_factor || 1);
				const stockRate = Number(item.price_list_rate ?? item.rate) / oldFactor;
				const configuredRate = item.uoms?.find((row) => row.uom === uom)?.rate;
				const rate = configuredRate == null ? stockRate * conversionFactor : Number(configuredRate);
				return {
					...item, uom, conversion_factor: conversionFactor, rate, price_list_rate: rate,
					pricing_override: undefined, batch_allocations: [], serial_allocations: []
				};
			});
			if (isLocalCart(invoice)) {
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}
			const updated = await runMutation(() => updateInvoiceFromCart(api.updateInvoiceFromCart, {
					invoice_doctype: invoice.doctype, invoice_name: invoice.name, customer: invoice.customer,
					price_list: get().selectedPriceList || invoice.selling_price_list,
					items: cartItemsPayload(nextItems),
				}));
			set({ invoice: updated });
		},

		updateCartItemSerialAllocations: async (rowName, allocations, api) => {
			const invoice = get().invoice;
			if (!invoice) return;
			const nextItems = invoice.items.map((item) => item.row_name === rowName
				? { ...item, serial_allocations: allocations || [] } : item);
			if (isLocalCart(invoice)) {
				// Store the selected serials before recalculating the preview. This closes the
				// gap where Hold could run after the checkbox changed but before the preview
				// promise updated the cart, incorrectly observing no serial allocation.
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}
			const updated = await runMutation(() => updateInvoiceFromCart(api.updateInvoiceFromCart, {
				invoice_doctype: invoice.doctype, invoice_name: invoice.name, customer: invoice.customer,
				price_list: get().selectedPriceList || invoice.selling_price_list,
				items: cartItemsPayload(nextItems),
			}));
			set({ invoice: updated });
		},

		updateCartItemBatchAllocations: async (rowName, allocations, api) => {
			const invoice = get().invoice;
			if (!invoice) return;
			const nextItems = invoice.items.map((item) =>
				item.row_name === rowName ? { ...item, batch_allocations: allocations || [] } : item,
			);
			validateManualBatchAllocations(nextItems);
			if (isLocalCart(invoice)) {
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}
			const updatedInvoice = await runMutation(() =>
				updateInvoiceFromCart(api.updateInvoiceFromCart, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					customer: invoice.customer,
					price_list: get().selectedPriceList || invoice.selling_price_list,
					items: cartItemsPayload(nextItems),
				}),
			);
			set({ invoice: preservePricingOverrides(updatedInvoice, nextItems) });
		},

		loadItemBatches: async (itemCode, warehouse, isOnline, api) => {
			const posProfile = get().posProfile;
			if (!posProfile || !warehouse) throw new Error("A POS Profile and warehouse are required to load batches.");
			if (!isOnline) throw new Error("Connect to the server to load current batch availability.");
			const fresh = await getItemBatches(api.getItemBatches, {
				item_code: itemCode,
				warehouse,
				pos_profile: posProfile,
			});
			return { ...fresh, verified_at: new Date().toISOString() };
		},

		removeCartItem: async (rowName, api, managerPinToken) => {
			const invoice = get().invoice;
			if (!invoice) {
				return;
			}

			if (isLocalCart(invoice)) {
				const nextItems = invoice.items.filter((row) => row.row_name !== rowName);
				if (!nextItems.length) {
					set({ invoice: null });
					return;
				}
				await applyOptimisticLocalCart(nextItems, invoice, api);
				return;
			}

			const updatedInvoice = await runMutation(() =>
				removeItem(api.removeItem, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					row_name: rowName,
					manager_pin_token: managerPinToken,
				}),
			);
			set({ invoice: updatedInvoice });
		},

		listHeld: async (api) => {
			set({ isHeldLoading: true, error: null });
			try {
				const rows = await listHeldInvoices(api.listHeldInvoices, {
					pos_profile: get().posProfile,
					limit: 20,
				});
				set({ heldInvoices: rows });
				return rows;
			} catch (err) {
				console.error(err);
				set({ error: err instanceof Error ? err.message : "Failed to load held invoices" });
				throw err;
			} finally {
				set({ isHeldLoading: false });
			}
		},

		clearCart: async (api) => {
			const invoice = get().invoice;
			if (!invoice?.items?.length) {
				set({ invoice: null, selectedPriceList: undefined });
				await restoreDefaultCataloguePricing(api);
				return;
			}

			if (isLocalCart(invoice)) {
				if (invoice.source_invoice_doctype && invoice.source_invoice_name) {
					await runMutation(() =>
						clearInvoice(api.clearInvoice, {
							invoice_doctype: invoice.source_invoice_doctype || "",
							invoice_name: invoice.source_invoice_name || "",
						}),
					);
					await get().listHeld(api);
				}
				set({ invoice: null, selectedPriceList: undefined });
				await restoreDefaultCataloguePricing(api);
				return;
			}

			const updatedInvoice = await runMutation(() =>
				clearInvoice(api.clearInvoice, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
				}),
			);
			set({ invoice: updatedInvoice.items.length ? updatedInvoice : null, selectedPriceList: undefined });
			await restoreDefaultCataloguePricing(api);
		},

		validateCart: async (api) => {
			const invoice = get().invoice;
			if (!invoice?.items?.length) return null;
			const items = invoice.items.map(clearIncompleteSerialAllocation);
			const selectedCustomer = getActiveCustomer(get());
			const sourceInvoice = getLocalCartSource(invoice);
			const authoritative = await runMutation(() => previewInvoice(api.previewInvoice, {
				pos_profile: get().posProfile,
				customer: selectedCustomer?.customer || invoice.customer,
				invoice_doctype: sourceInvoice?.doctype || invoice.doctype,
				price_list: get().selectedPriceList,
				items: cartItemsPayload(items),
			}));
			const validated = localizePreviewInvoice(
				authoritative,
				items,
				selectedCustomer,
				sourceInvoice,
			);
			set({ invoice: validated });
			return validated;
		},

		previewLoyaltyRedemption: async (loyaltyPoints, api) => {
			const invoice = get().invoice;
			if (!invoice?.items?.length) return null;
			const items = invoice.items.map(clearIncompleteSerialAllocation);
			const selectedCustomer = getActiveCustomer(get());
			const sourceInvoice = getLocalCartSource(invoice);
			const authoritative = await runMutation(() => previewInvoice(api.previewInvoice, {
				pos_profile: get().posProfile,
				customer: selectedCustomer?.customer || invoice.customer,
				invoice_doctype: sourceInvoice?.doctype || invoice.doctype,
				price_list: get().selectedPriceList,
				items: cartItemsPayload(items),
				loyalty_points: loyaltyPoints || undefined,
			}));
			const validated = localizePreviewInvoice(authoritative, items, selectedCustomer, sourceInvoice);
			set({ invoice: validated });
			return validated;
		},

		refreshCartConfiguration: async (api) => {
			const invoice = get().invoice;
			if (!invoice?.items.length) return null;
			const catalogueItems = await Promise.all(
				invoice.items.map((item) => itemRepository.getByCode(item.item_code)),
			);
			const refreshedItems = invoice.items.map((item, index) => {
				const catalogueItem = catalogueItems[index];
				if (!catalogueItem) return item;
				const conversionFactor = Number(item.conversion_factor || 1);
				const configuredUomRate = catalogueItem.uoms?.find((row) => row.uom === item.uom)?.rate;
				const stockRate = Number(catalogueItem.price_list_rate ?? catalogueItem.rate ?? item.price_list_rate ?? item.rate);
				const priceListRate = configuredUomRate == null
					? stockRate * conversionFactor
					: Number(configuredUomRate);
				return {
					...item,
					rate: priceListRate,
					price_list_rate: priceListRate,
					actual_qty: catalogueItem.actual_qty ?? undefined,
					allow_negative_stock: catalogueItem.allow_negative_stock,
					has_batch_no: catalogueItem.has_batch_no,
					has_serial_no: catalogueItem.has_serial_no,
					item_tax_template: catalogueItem.item_tax_template,
					item_tax: catalogueItem.item_tax ?? undefined,
					uoms: catalogueItem.uoms,
					catalogue_pricing_rule: catalogueItem.pricing_rule,
				};
			});
			const selectedCustomer = getActiveCustomer(get());
			const customer = selectedCustomer?.customer || invoice.customer;
			if (!customer) {
				// A cashier may build a cart before choosing a customer. Configuration
				// refreshes must still work, so recalculate that cart from the freshly
				// hydrated catalogue and defer customer validation until checkout.
				const refreshed = await runMutation(() => previewCartWithPricingRules(refreshedItems, invoice, api));
				set({ invoice: refreshed });
				return refreshed;
			}

			const validated = await get().validateCart(api);
			if (!validated) return null;
			const refreshed = {
				...validated,
				items: validated.items.map((item, index) => {
					const catalogueItem = catalogueItems[index];
					return catalogueItem ? {
						...item,
						actual_qty: catalogueItem.actual_qty ?? undefined,
						allow_negative_stock: catalogueItem.allow_negative_stock,
						has_batch_no: catalogueItem.has_batch_no,
						has_serial_no: catalogueItem.has_serial_no,
						item_tax_template: catalogueItem.item_tax_template,
						item_tax: catalogueItem.item_tax ?? undefined,
						uoms: catalogueItem.uoms,
						catalogue_pricing_rule: catalogueItem.pricing_rule,
					} : item;
				}),
			};
			set({ invoice: refreshed });
			return refreshed;
		},

		refreshCustomerPricing: async (customer, api) => {
			set({ selectedPriceList: undefined });
			const requestedCustomer = (customer === undefined ? get().defaultCustomer : customer)?.customer;
			const pricedItems = await runMutation(() => searchItems(api.searchItems, {
				pos_profile: get().posProfile,
				customer: requestedCustomer,
				limit: 100000,
			}));
			// Ignore a response that completed after the cashier selected another customer.
			if (getActiveCustomer(get())?.customer !== requestedCustomer) return get().invoice;
			await itemRepository.replaceAll(pricedItems);
			useRuntimeCacheStore.getState().touch();
			if (!get().invoice?.items.length) return null;
			return get().validateCart(api);
		},

		refreshPriceListPricing: async (priceList, api) => {
			const requestedCustomer = getActiveCustomer(get())?.customer;
			const pricedItems = await runMutation(() => searchItems(api.searchItems, {
				pos_profile: get().posProfile,
				customer: requestedCustomer,
				price_list: priceList,
				limit: 100000,
			}));
			set({ selectedPriceList: priceList });
			await itemRepository.replaceAll(pricedItems);
			useRuntimeCacheStore.getState().touch();
			if (!get().invoice?.items.length) return null;
			return get().validateCart(api);
		},

		submitCart: async (
			payments,
			printFormat,
			idempotencyKey,
			api,
			isOnline = false,
			isCreditSale = false,
			dueDate,
			loyaltyPoints,
			taxId,
			orderType = "Sales Invoice",
			salesperson,
			salespersonToken,
		) => {
			if (!isOnline) {
				throw new Error("VunaPOS is online-only. Reconnect before completing this sale.");
			}
			let invoice = get().invoice;
			if (!invoice) {
				return null;
			}

			const selectedCustomer = getActiveCustomer(get());
			if (isOnline && isUnsyncedLocalCart(invoice)) {
				invoice = await runMutation(() =>
					refreshAndValidateStock(
						invoice as InvoiceDTO,
						get().posProfile,
						selectedCustomer?.customer,
						get().selectedPriceList,
						api,
					),
				);
				set({ invoice });
			}

			for (const item of invoice.items) {
				validateAvailableQty(item, item.qty);
			}
			validateManualBatchAllocations(invoice.items);

			if (orderType === "Sales Order") {
				if (!isUnsyncedLocalCart(invoice)) {
					throw new Error("Restore this held invoice as a Sales Invoice, or clear the cart and create a new Sales Order.");
				}
				const salesOrder = await runMutation(() =>
					createAndSubmitSalesOrder(api.createAndSubmitSalesOrder, {
						pos_profile: get().posProfile,
						customer: selectedCustomer?.customer,
						price_list: get().selectedPriceList,
						items: cartItemsPayload(invoice.items),
						payments,
						idempotency_key: idempotencyKey,
						delivery_date: dueDate,
						tax_id: taxId,
						salesperson,
						salesperson_token: salespersonToken,
					}),
				);
				try {
					const receipt = await renderInvoice(api.renderInvoice, {
						invoice_doctype: salesOrder.doctype,
						invoice_name: salesOrder.name,
						print_format: printFormat || undefined,
					});
					set({ invoice: null, selectedPriceList: undefined });
					await restoreDefaultCataloguePricing(api);
					return { invoice: salesOrder, printPayload: receipt };
				} catch (err) {
					console.error(err);
					set({ invoice: null, selectedPriceList: undefined });
					await restoreDefaultCataloguePricing(api);
					return { invoice: salesOrder, printPayload: null };
				}
			}

			if (isUnsyncedLocalCart(invoice)) {
				const submittedInvoice = await runMutation(() =>
					createAndSubmitInvoice(api.createAndSubmitInvoice, {
						pos_profile: get().posProfile,
						customer: selectedCustomer?.customer,
						price_list: get().selectedPriceList,
						items: cartItemsPayload(invoice.items),
						payments,
						idempotency_key: idempotencyKey,
						is_credit_sale: isCreditSale,
						due_date: dueDate,
						loyalty_points: loyaltyPoints,
						tax_id: taxId,
						salesperson,
						salesperson_token: salespersonToken,
					}),
				);
				await refreshSoldItemStock(
					invoice.items, get().posProfile, selectedCustomer?.customer, get().selectedPriceList, api,
				);
				if (submittedInvoice.queue_status === "Queued" || submittedInvoice.queue_status === "Processing") {
					set({ invoice: null, selectedPriceList: undefined });
					await restoreDefaultCataloguePricing(api);
					return { invoice: submittedInvoice, printPayload: null };
				}
				try {
					const receipt = await renderInvoice(api.renderInvoice, {
						invoice_doctype: submittedInvoice.doctype,
						invoice_name: submittedInvoice.name,
						print_format: printFormat || undefined,
					});
					set({ invoice: null, selectedPriceList: undefined });
					await restoreDefaultCataloguePricing(api);
					return { invoice: submittedInvoice, printPayload: receipt };
				} catch (err) {
					console.error(err);
					set({ invoice: null, selectedPriceList: undefined });
					await restoreDefaultCataloguePricing(api);
					return { invoice: submittedInvoice, printPayload: null };
				}
			}

			// Holds stay online-only for now - cutting them over to local-only is an explicit
			// feature change that needs client sign-off, not something to do silently here.
			const submittedInvoice = await runMutation(() => {
				if (isLocalCart(invoice)) {
					return syncLocalCartToSource(invoice, api).then((updatedInvoice) =>
						checkoutInvoice(api.checkoutInvoice, {
							invoice_doctype: updatedInvoice?.doctype || invoice.source_invoice_doctype || "",
							invoice_name: updatedInvoice?.name || invoice.source_invoice_name || "",
							payments,
							idempotency_key: idempotencyKey,
							is_credit_sale: isCreditSale,
							due_date: dueDate,
							loyalty_points: loyaltyPoints,
							tax_id: taxId,
							 salesperson,
							salesperson_token: salespersonToken,
						}),
					);
				}

				return checkoutInvoice(api.checkoutInvoice, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					payments,
					idempotency_key: idempotencyKey,
					is_credit_sale: isCreditSale,
					due_date: dueDate,
					loyalty_points: loyaltyPoints,
					tax_id: taxId,
						salesperson,
						salesperson_token: salespersonToken,
				});
			});
			await refreshSoldItemStock(
				invoice.items, get().posProfile, selectedCustomer?.customer, get().selectedPriceList, api,
			);

			try {
				const receipt = await renderInvoice(api.renderInvoice, {
					invoice_doctype: submittedInvoice.doctype,
					invoice_name: submittedInvoice.name,
					print_format: printFormat || undefined,
				});
				set({ invoice: null, selectedPriceList: undefined });
				await restoreDefaultCataloguePricing(api);
				return { invoice: submittedInvoice, printPayload: receipt };
			} catch (err) {
				console.error(err);
				set({ invoice: null, selectedPriceList: undefined });
				await restoreDefaultCataloguePricing(api);
				return { invoice: submittedInvoice, printPayload: null };
			}
		},

		holdCart: async (api) => {
			const invoice = get().invoice;
			if (!invoice?.items?.length) {
				return null;
			}

			for (const item of invoice.items) {
				validateAvailableQty(item, item.qty);
			}
			validateManualBatchAllocations(invoice.items);

			const selectedCustomer = getActiveCustomer(get());
			const posProfile = get().posProfile;

			const heldInvoice = await runMutation(() => {
				if (isLocalCart(invoice)) {
					if (invoice.source_invoice_doctype && invoice.source_invoice_name) {
						return syncLocalCartToSource(invoice, api).then((updatedInvoice) =>
							holdInvoice(api.holdInvoice, {
								invoice_doctype: updatedInvoice?.doctype || invoice.source_invoice_doctype || "",
								invoice_name: updatedInvoice?.name || invoice.source_invoice_name || "",
							}),
						);
					}

					return createInvoiceFromCart(api.createInvoiceFromCart, {
						pos_profile: posProfile,
						customer: selectedCustomer?.customer,
						price_list: get().selectedPriceList,
						items: cartItemsPayload(invoice.items),
						loyalty_points: invoice.loyalty_points || undefined,
					}).then((draftInvoice) =>
						holdInvoice(api.holdInvoice, {
							invoice_doctype: draftInvoice.doctype,
							invoice_name: draftInvoice.name,
						}),
					);
				}

				return holdInvoice(api.holdInvoice, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
				});
			});

			set({ invoice: null, selectedPriceList: undefined });
			await restoreDefaultCataloguePricing(api);
			await get().listHeld(api);
			return heldInvoice;
		},

		restoreHeldInvoice: async (heldInvoice, api) => {
			const restoredInvoice = await runMutation(() =>
				restoreInvoice(api.restoreInvoice, {
					invoice_doctype: heldInvoice.doctype,
					invoice_name: heldInvoice.name,
				}),
			);
			set({
				invoice: invoiceToLocalCart(restoredInvoice),
				selectedPriceList: restoredInvoice.selling_price_list,
			});
			if (restoredInvoice.selling_price_list) {
				await get().refreshPriceListPricing(restoredInvoice.selling_price_list, api);
			}
			await get().listHeld(api);
			return restoredInvoice;
		},
	};
});
