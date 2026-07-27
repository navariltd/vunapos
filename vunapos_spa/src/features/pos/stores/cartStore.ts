import { create } from "zustand";

import type {
	CustomerDTO,
	HeldInvoiceDTO,
	InvoiceDTO,
	InvoiceItemDTO,
	ItemDTO,
	PaymentInput,
	PrintPayload,
} from "../types";
import { holdRepository } from "../../../lib/holdRepository";
import { assembleInvoice, type AssembledInvoice, type ItemTaxRow } from "../../../lib/invoiceEngine";
import { invoiceRepository } from "../../../lib/invoiceRepository";
import { renderLocalReceipt } from "../../../lib/localReceipt";
import { customerRepository } from "../../../lib/repositories/customerRepository";
import { itemRepository } from "../../../lib/repositories/itemRepository";
import { itemTaxTemplateRepository } from "../../../lib/repositories/itemTaxTemplateRepository";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import { queueRepository } from "../../../lib/repositories/queueRepository";
import { taxTemplateRepository } from "../../../lib/repositories/taxTemplateRepository";
import { drainQueue } from "../../../lib/syncEngine";
import { resolveTaxSettings } from "../../../lib/taxSettings";
import {
	addItem,
	checkoutInvoice,
	clearInvoice,
	createInvoiceFromCart,
	getItemDetails,
	holdInvoice,
	listHeldInvoices,
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
	updateItem: FrappeCall;
	removeItem: FrappeCall;
	clearInvoice: FrappeCall;
	createInvoiceFromCart: FrappeCall;
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

// A brand-new cart that has never been queued/synced anywhere - the only case that
// can hold (or sell) fully offline. Exported so POSHomePage can decide whether
// holdCart needs a connectivity pre-check without duplicating this condition.
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
	};
}

function localizePreviewInvoice(
	preview: InvoiceDTO,
	localItems: InvoiceItemDTO[],
	selectedCustomer?: CustomerDTO | null,
	sourceInvoice?: Pick<InvoiceDTO, "doctype" | "name">,
) {
	const metadataByItemCode = new Map(localItems.map((item) => [item.item_code, item]));
	return {
		...preview,
		name: sourceInvoice?.name || "Not invoiced yet",
		is_local: true,
		source_invoice_doctype: sourceInvoice?.doctype,
		source_invoice_name: sourceInvoice?.name,
		customer: selectedCustomer?.customer || preview.customer,
		customer_name: selectedCustomer?.customer_name || preview.customer_name,
		items: preview.items.map((item) => {
			const metadata = metadataByItemCode.get(item.item_code);
			return {
				...item,
				row_name: item.row_name || metadata?.row_name || item.item_code,
				actual_qty: metadata?.actual_qty,
				is_stock_item: metadata?.is_stock_item,
				allow_negative_stock: metadata?.allow_negative_stock,
				has_batch_no: metadata?.has_batch_no,
				has_serial_no: metadata?.has_serial_no,
				warehouse: metadata?.warehouse,
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
	const metaByCode = new Map(sourceItems.map((item) => [item.item_code, item]));
	return {
		doctype: sourceInvoice?.doctype || "Sales Invoice",
		name: sourceInvoice?.name || "Not invoiced yet",
		docstatus: 0,
		items: assembled.items.map((item) => {
			const meta = metaByCode.get(item.item_code);
			return {
				row_name: meta?.row_name || item.item_code,
				item_code: item.item_code,
				item_name: meta?.item_name || item.item_code,
				description: meta?.description,
				qty: item.qty,
				uom: meta?.uom,
				stock_uom: meta?.stock_uom,
				conversion_factor: meta?.conversion_factor,
				rate: item.rate,
				price_list_rate: meta?.price_list_rate ?? meta?.rate ?? item.rate,
				discount_percentage: meta?.discount_percentage,
				discount_amount: meta?.discount_amount,
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
				// Required: the next previewLocalCart round-trip reads item_tax_template back
				// off this output as its source items - omitting it silently zeroes item tax.
				item_tax_template: meta?.item_tax_template,
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

function toSubmittedInvoiceDTO(
	assembled: AssembledInvoice,
	sourceItems: InvoiceItemDTO[],
	name: string,
	payments: PaymentInput[],
): InvoiceDTO {
	const invoice = assembledToInvoiceDTO(assembled, sourceItems);
	const invoiceTotal = assembled.totals.rounded_total || assembled.totals.grand_total;
	const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
	return {
		...invoice,
		name,
		docstatus: 1,
		payments,
		totals: {
			...invoice.totals,
			paid_amount: paidAmount,
			change_amount: Math.max(paidAmount - invoiceTotal, 0),
			outstanding_amount: Math.max(invoiceTotal - paidAmount, 0),
		},
	};
}

function toHeldInvoiceDTO(assembled: AssembledInvoice, sourceItems: InvoiceItemDTO[], name: string): InvoiceDTO {
	return { ...assembledToInvoiceDTO(assembled, sourceItems), name, docstatus: 0, is_local: true };
}

const SETTLEMENT_RACE_MS = 6000;

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
	const rateByCode = new Map(items.map((row) => [row.item_code, Number(row.rate || 0)]));
	return assembleInvoice({
		cart: items.map((row) => ({ item_code: row.item_code, qty: row.qty })),
		priceResolver: (code) => rateByCode.get(code),
		taxRows: taxTemplate?.taxes ?? [],
		itemTaxResolver: (code) => {
			const templateName = itemTaxTemplateByCode.get(code);
			return templateName ? itemTaxRowsByTemplate.get(templateName) : undefined;
		},
		taxSettings,
	});
}

function itemToCartRow(item: ItemDTO, qty = 1): InvoiceItemDTO {
	const rate = Number(item.rate || 0);
	return {
		row_name: item.item_code,
		item_code: item.item_code,
		item_name: item.item_name,
		description: item.description,
		qty,
		uom: item.uom || item.stock_uom,
		stock_uom: item.stock_uom,
		rate,
		price_list_rate: rate,
		amount: rate * qty,
		actual_qty: item.actual_qty,
		is_stock_item: item.is_stock_item,
		allow_negative_stock: item.allow_negative_stock,
		has_batch_no: item.has_batch_no,
		has_serial_no: item.has_serial_no,
		item_tax_template: item.item_tax_template,
	};
}

function updateLocalQty(row: InvoiceItemDTO, qty: number): InvoiceItemDTO {
	return {
		...row,
		qty,
		amount: Number(row.rate || 0) * qty,
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

	if (qty > Number(item.actual_qty || 0)) {
		throw new Error(`Insufficient stock for ${item.item_name}. Available quantity is ${item.actual_qty}.`);
	}
}

async function refreshAndValidateStock(
	invoice: InvoiceDTO,
	posProfile: string | undefined,
	customer: string | undefined,
	api: CartApi,
): Promise<InvoiceDTO> {
	const requestedByCode = new Map<string, number>();
	for (const item of invoice.items) {
		requestedByCode.set(item.item_code, (requestedByCode.get(item.item_code) || 0) + item.qty);
	}

	const freshByCode = new Map<string, ItemDTO>();
	await Promise.all(
		Array.from(requestedByCode).map(async ([itemCode, qty]) => {
			const fresh = await getItemDetails(api.getItemDetails, {
				item_code: itemCode,
				pos_profile: posProfile,
				customer,
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
};

export function getActiveCustomer(
	state: Pick<CartState, "selectedCustomerOverride" | "defaultCustomer">,
): CustomerDTO | null {
	return state.selectedCustomerOverride === undefined ? state.defaultCustomer : state.selectedCustomerOverride;
}

export type SubmitCartResult = { invoice: InvoiceDTO; printPayload: PrintPayload | null };

type CartActions = {
	setPosProfile: (posProfile: string | undefined) => void;
	setDefaultCustomer: (customer: CustomerDTO | null) => void;
	setSelectedCustomer: (customer: CustomerDTO | null | undefined) => void;
	addCartItem: (item: ItemDTO, api: CartApi) => Promise<void>;
	updateCartItemQty: (rowName: string, qty: number, api: CartApi) => Promise<void>;
	removeCartItem: (rowName: string, api: CartApi) => Promise<void>;
	listHeld: (api: CartApi) => Promise<HeldInvoiceDTO[]>;
	/** Unconditional - the confirm-before-clearing dialog is a UI concern that lives
	 * at the call site (POSHomePage), not here (no Node equivalent to window.confirm). */
	clearCart: (api: CartApi) => Promise<void>;
	submitCart: (
		payments: PaymentInput[],
		printFormat: string | null | undefined,
		idempotencyKey: string | undefined,
		api: CartApi,
		isOnline?: boolean,
	) => Promise<SubmitCartResult | null>;
	holdCart: (api: CartApi) => Promise<InvoiceDTO | null>;
	restoreHeldInvoice: (heldInvoice: HeldInvoiceDTO, api: CartApi) => Promise<InvoiceDTO>;
	/** Restores a not-yet-synced local hold - purely local, no network call, works in
	 * any queue status (pending/syncing/error) since it's still just local data
	 * regardless of sync status. */
	restoreLocalHold: (localId: string, api: CartApi) => Promise<InvoiceDTO>;
	restoreFailedSale: (localId: string) => Promise<InvoiceDTO>;
};

export type CartStore = CartState & CartActions;

export const useCartStore = create<CartStore>((set, get) => {
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

	async function syncLocalCartToSource(cart: InvoiceDTO, api: CartApi) {
		if (!cart.source_invoice_doctype || !cart.source_invoice_name) {
			return null;
		}

		const selectedCustomer = getActiveCustomer(get());
		return updateInvoiceFromCart(api.updateInvoiceFromCart, {
			invoice_doctype: cart.source_invoice_doctype,
			invoice_name: cart.source_invoice_name,
			customer: selectedCustomer?.customer || cart.customer,
			items: cart.items.map((item) => ({
				item_code: item.item_code,
				qty: item.qty,
			})),
		});
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

		setPosProfile: (posProfile) => set({ posProfile }),
		setDefaultCustomer: (defaultCustomer) => set({ defaultCustomer }),
		setSelectedCustomer: (selectedCustomerOverride) => set({ selectedCustomerOverride }),

		addCartItem: async (item, api) => {
			if (isStockControlled(item)) {
				validateAvailableQty(item, 1);
			}

			const invoice = get().invoice;
			if (!invoice || isLocalCart(invoice) || invoice.docstatus !== 0) {
				const currentItems = invoice && isLocalCart(invoice) && invoice.docstatus === 0 ? invoice.items : [];
				const existingItem = currentItems.find((row) => row.item_code === item.item_code);
				const nextItems = existingItem
					? currentItems.map((row) => {
							if (row.item_code === item.item_code) {
								validateAvailableQty(row, row.qty + 1);
								return updateLocalQty(row, row.qty + 1);
							}
							return row;
						})
					: [...currentItems, itemToCartRow(item)];
				const preview = await runMutation(() => previewLocalCart(nextItems, invoice));
				set({ invoice: preview });
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
				const preview = await runMutation(() => previewLocalCart(nextItems, invoice));
				set({ invoice: preview });
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

		removeCartItem: async (rowName, api) => {
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
				const preview = await runMutation(() => previewLocalCart(nextItems, invoice));
				set({ invoice: preview });
				return;
			}

			const updatedInvoice = await runMutation(() =>
				removeItem(api.removeItem, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					row_name: rowName,
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
				set({ invoice: null });
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
				set({ invoice: null });
				return;
			}

			const updatedInvoice = await runMutation(() =>
				clearInvoice(api.clearInvoice, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
				}),
			);
			set({ invoice: updatedInvoice.items.length ? updatedInvoice : null });
		},

		submitCart: async (payments, printFormat, idempotencyKey, api, isOnline = false) => {
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
						api,
					),
				);
				set({ invoice });
			}

			for (const item of invoice.items) {
				validateAvailableQty(item, item.qty);
			}

			// The common "new sale" path: a local cart with no server draft behind it yet.
			// This is the one the problem statement is actually about (I3/I6) - it always
			// goes through the sync queue, online or offline, never a direct server call.
			if (isUnsyncedLocalCart(invoice)) {
				return runMutation(async () => {
					const local = await invoiceRepository.create({
						customer: selectedCustomer?.customer,
						items: invoice.items.map((item) => ({ item_code: item.item_code, qty: item.qty })),
						payments: payments.map((payment) => ({
							mode_of_payment: payment.mode_of_payment,
							amount: payment.amount,
						})),
					}, idempotencyKey);

					// Race a real sync against a short timeout: online, swap in the server-verified
					// receipt; offline/slow, fall back to the local estimate - already "sold" from
					// the cashier's point of view the moment it was queued.
					await Promise.race([drainQueue(), new Promise((resolve) => setTimeout(resolve, SETTLEMENT_RACE_MS))]);

					const settled = await queueRepository.getByLocalId(local.local_id);
					if (settled?.status === "error") {
						// Rejected within the race window (e.g. totals-variance/stock check) is
						// dead, not "pending" (will sync later) - surface it now, cashier-present.
						const lastAttempt = settled.attempts.at(-1);
						await queueRepository.remove(local.local_id);
						throw new Error(
							lastAttempt?.detail ||
								"This sale was rejected by the server and could not be completed. Please review the cart and try again.",
						);
					}
					if (settled?.status === "succeeded") {
						const serverName = await queueRepository.getMapping(local.local_id);
						if (serverName) {
							try {
								const receipt = await renderInvoice(api.renderInvoice, {
									invoice_doctype: settled.payload.invoice_doctype || "Sales Invoice",
									invoice_name: serverName,
									print_format: printFormat || undefined,
								});
								const submitted = toSubmittedInvoiceDTO(local.assembled, invoice.items, serverName, payments);
								set({ invoice: null });
								return { invoice: submitted, printPayload: receipt };
							} catch (err) {
								console.error("Receipt render failed after sync; falling back to the local estimate", err);
							}
						}
					}

					// Not synced within the race window (offline, or just slow) - the sale is
					// no less real (I1), so it gets no less of a receipt. Rendered locally
					// (ADR-012/N8) since there's no server print format to ask for one.
					const provisional = toSubmittedInvoiceDTO(local.assembled, invoice.items, local.local_ref, payments);
					const profile = await profileRepository.getActive();
					const html = renderLocalReceipt({
						localRef: local.local_ref,
						assembled: local.assembled,
						customerName: selectedCustomer?.customer_name,
						payments: payments.map((payment) => ({
							mode_of_payment: payment.mode_of_payment,
							amount: payment.amount,
						})),
						companyName: profile?.company,
						posProfileName: profile?.name,
						currency: profile?.currency,
						postingDate: local.posting_date,
						postingTime: local.posting_time,
					});
					const localPrintPayload: PrintPayload = {
						invoice_doctype: "Sales Invoice",
						invoice_name: local.local_ref,
						print_format: null,
						html,
					};
					set({ invoice: null });
					return { invoice: provisional, printPayload: localPrintPayload };
				});
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
						}),
					);
				}

				return checkoutInvoice(api.checkoutInvoice, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					payments,
					idempotency_key: idempotencyKey,
				});
			});

			try {
				const receipt = await renderInvoice(api.renderInvoice, {
					invoice_doctype: submittedInvoice.doctype,
					invoice_name: submittedInvoice.name,
					print_format: printFormat || undefined,
				});
				set({ invoice: null });
				return { invoice: submittedInvoice, printPayload: receipt };
			} catch (err) {
				console.error(err);
				set({ invoice: null });
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

			const selectedCustomer = getActiveCustomer(get());
			const posProfile = get().posProfile;

			// Unlike submitCart's local-cart branch, no trailing listHeld() call here: it's a
			// real network call that would appear to fail offline even though the hold
			// succeeded and is durably queued - the merged Invoices panel already reflects it.
			if (isUnsyncedLocalCart(invoice)) {
				return runMutation(async () => {
					const local = await holdRepository.create({
						customer: selectedCustomer?.customer,
						items: invoice.items.map((item) => ({ item_code: item.item_code, qty: item.qty })),
					});

					await Promise.race([drainQueue(), new Promise((resolve) => setTimeout(resolve, SETTLEMENT_RACE_MS))]);

					const settled = await queueRepository.getByLocalId(local.local_id);
					if (settled?.status === "error") {
						const lastAttempt = settled.attempts.at(-1);
						throw new Error(
							lastAttempt?.detail ||
								"This held sale was rejected by the server and could not be saved. Please review the cart and try again.",
						);
					}

					set({ invoice: null });

					if (settled?.status === "succeeded") {
						const serverName = await queueRepository.getMapping(local.local_id);
						if (serverName) {
							return toHeldInvoiceDTO(local.assembled, invoice.items, serverName);
						}
					}

					// Not synced within the race window (offline, or just slow) - the hold is
					// no less real (I1), it just hasn't reached ERPNext yet.
					return toHeldInvoiceDTO(local.assembled, invoice.items, local.local_ref);
				});
			}

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
						items: invoice.items.map((item) => ({
							item_code: item.item_code,
							qty: item.qty,
						})),
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

			set({ invoice: null });
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
			set({ invoice: invoiceToLocalCart(restoredInvoice) });
			await get().listHeld(api);
			return restoredInvoice;
		},

		restoreLocalHold: async (localId) => {
			return runMutation(async () => {
				const entry = await queueRepository.getByLocalId(localId);
				if (!entry || entry.type !== "hold_invoice") {
					throw new Error("This held sale is no longer available on this device.");
				}

				// Re-resolve each item against current cached data (price, tax template)
				// rather than trusting the stale queued item_code/qty snapshot.
				const itemRows = await Promise.all(
					entry.payload.items.map(async (line) => {
						const cached = await itemRepository.getByCode(line.item_code);
						if (!cached) {
							throw new Error(`Item ${line.item_code} is no longer available locally - sync and try again.`);
						}
						return itemToCartRow(cached as ItemDTO, line.qty);
					}),
				);

				let customer: CustomerDTO | null = null;
				if (entry.payload.customer) {
					const cached = await customerRepository.getByName(entry.payload.customer);
					customer = cached ?? { customer: entry.payload.customer, customer_name: entry.payload.customer };
				}
				// Must happen before previewLocalCart, which derives customer/customer_name
				// from getActiveCustomer(get()) at call time via localizePreviewInvoice.
				set({ selectedCustomerOverride: customer });

				// No source invoice - this is a fresh local cart, not a re-attach to the
				// (nonexistent) server doc, so re-holding/checking it out goes back through
				// the local queue (holdRepository/invoiceRepository), not syncLocalCartToSource.
				const preview = await previewLocalCart(itemRows, null);

				// Delete only after the rebuild succeeds - if item resolution throws above,
				// the local hold must still exist afterward rather than being silently lost.
				await queueRepository.remove(localId);

				set({ invoice: preview });
				return preview;
			});
		},

		restoreFailedSale: async (localId) => {
			return runMutation(async () => {
				const entry = await queueRepository.getByLocalId(localId);
				if (!entry || entry.type !== "create_invoice" || entry.status !== "error") {
					throw new Error("This failed offline sale is no longer available on this device.");
				}

				const itemRows = await Promise.all(
					entry.payload.items.map(async (line) => {
						const cached = await itemRepository.getByCode(line.item_code);
						if (!cached) {
							throw new Error(`Item ${line.item_code} is no longer available locally - sync and try again.`);
						}
						return itemToCartRow(cached as ItemDTO, line.qty);
					}),
				);

				let customer: CustomerDTO | null = null;
				if (entry.payload.customer) {
					const cached = await customerRepository.getByName(entry.payload.customer);
					customer = cached ?? { customer: entry.payload.customer, customer_name: entry.payload.customer };
				}
				set({ selectedCustomerOverride: customer });
				const preview = await previewLocalCart(itemRows, null);
				await queueRepository.remove(localId);
				set({ invoice: preview });
				return preview;
			});
		},
	};
});
