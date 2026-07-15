import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { CustomerDTO, HeldInvoiceDTO, InvoiceDTO, InvoiceItemDTO, ItemDTO, PaymentInput, PrintPayload } from "../types";
import {
	addItem,
	clearInvoice,
	createInvoiceFromCart,
	checkoutInvoice,
	holdInvoice,
	listHeldInvoices,
	previewInvoice,
	renderInvoice,
	removeItem,
	restoreInvoice,
	updateItem,
	updateInvoiceFromCart,
	vunaMethods,
} from "../../../services/vunaApi";

type UsePOSInvoiceArgs = {
	posProfile?: string;
	selectedCustomer?: CustomerDTO | null;
};

function isLocalCart(invoice?: InvoiceDTO | null) {
	return Boolean(invoice?.is_local);
}

function getCartTotal(items: InvoiceItemDTO[]) {
	return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function buildLocalCart(
	items: InvoiceItemDTO[],
	selectedCustomer?: CustomerDTO | null,
	sourceInvoice?: Pick<InvoiceDTO, "doctype" | "name">,
): InvoiceDTO {
	const total = getCartTotal(items);
	return {
		doctype: "VunaPOS Cart",
		name: "Not invoiced yet",
		docstatus: 0,
		is_local: true,
		source_invoice_doctype: sourceInvoice?.doctype,
		source_invoice_name: sourceInvoice?.name,
		customer: selectedCustomer?.customer,
		customer_name: selectedCustomer?.customer_name,
		items,
		totals: {
			net_total: total,
			total_taxes_and_charges: 0,
			grand_total: total,
			rounded_total: total,
		},
	};
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

function invoiceToLocalCart(invoice: InvoiceDTO): InvoiceDTO {
	return {
		...buildLocalCart(
			invoice.items,
			invoice.customer
				? {
						customer: invoice.customer,
						customer_name: invoice.customer_name || invoice.customer,
					}
				: null,
			{ doctype: invoice.doctype, name: invoice.name },
		),
		name: invoice.name,
		customer: invoice.customer,
		customer_name: invoice.customer_name,
		modified: invoice.modified,
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
		items: (preview.items ?? []).map((item) => {
			const metadata = metadataByItemCode.get(item.item_code);
			return {
				...item,
				row_name: item.row_name || metadata?.row_name || item.item_code,
				actual_qty: metadata?.actual_qty,
				is_stock_item: metadata?.is_stock_item,
				allow_negative_stock: metadata?.allow_negative_stock,
			};
		}),
	};
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
		rate,
		amount: rate * qty,
		actual_qty: item.actual_qty,
		is_stock_item: item.is_stock_item,
		allow_negative_stock: item.allow_negative_stock,
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

export function usePOSInvoice({ posProfile, selectedCustomer }: UsePOSInvoiceArgs) {
	const addItemCall = useFrappePostCall(vunaMethods.addItem);
	const updateItemCall = useFrappePostCall(vunaMethods.updateItem);
	const removeItemCall = useFrappePostCall(vunaMethods.removeItem);
	const clearInvoiceCall = useFrappePostCall(vunaMethods.clearInvoice);
	const createInvoiceFromCartCall = useFrappePostCall(vunaMethods.createInvoiceFromCart);
	const checkoutInvoiceCall = useFrappePostCall(vunaMethods.checkoutInvoice);
	const holdInvoiceCall = useFrappePostCall(vunaMethods.holdInvoice);
	const listHeldInvoicesCall = useFrappePostCall(vunaMethods.listHeldInvoices);
	const previewInvoiceCall = useFrappePostCall(vunaMethods.previewInvoice);
	const restoreInvoiceCall = useFrappePostCall(vunaMethods.restoreInvoice);
	const updateInvoiceFromCartCall = useFrappePostCall(vunaMethods.updateInvoiceFromCart);
	const renderInvoiceCall = useFrappePostCall(vunaMethods.renderInvoice);

	const [invoice, setInvoice] = useState<InvoiceDTO | null>(null);
	const [heldInvoices, setHeldInvoices] = useState<HeldInvoiceDTO[]>([]);
	const [printPayload, setPrintPayload] = useState<PrintPayload | null>(null);
	const [isMutating, setIsMutating] = useState(false);
	const [isHeldLoading, setIsHeldLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const runMutation = useCallback(async <T,>(mutation: () => Promise<T>) => {
		setIsMutating(true);
		setError(null);
		try {
			return await mutation();
		} catch (err) {
			console.error(err);
			setError(err instanceof Error ? err.message : "Invoice action failed");
			throw err;
		} finally {
			setIsMutating(false);
		}
	}, []);

	const previewLocalCart = useCallback(
		async (items: InvoiceItemDTO[], currentInvoice?: InvoiceDTO | null) => {
			const sourceInvoice = getLocalCartSource(currentInvoice);
			const preview = await previewInvoice(previewInvoiceCall.call, {
				pos_profile: posProfile,
				customer: selectedCustomer?.customer,
				items: items.map((item) => ({
					item_code: item.item_code,
					qty: item.qty,
				})),
				invoice_doctype: sourceInvoice?.doctype,
			});
			return localizePreviewInvoice(preview, items, selectedCustomer, sourceInvoice);
		},
		[posProfile, previewInvoiceCall.call, selectedCustomer],
	);
	const addCartItem = useCallback(
		async (item: ItemDTO) => {
			if (isStockControlled(item)) {
				validateAvailableQty(item, 1);
			}

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
				setInvoice(preview);
				return;
			}

			const updatedInvoice = await runMutation(() =>
				addItem(addItemCall.call, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					item_code: item.item_code,
					qty: 1,
				}),
			);
			setInvoice(updatedInvoice);
		},
		[addItemCall.call, invoice, previewLocalCart, runMutation],
	);

	const updateCartItemQty = useCallback(
		async (rowName: string, qty: number) => {
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
					setInvoice(null);
					return;
				}
				const preview = await runMutation(() => previewLocalCart(nextItems, invoice));
				setInvoice(preview);
				return;
			}

			if (qty <= 0) {
				const updatedInvoice = await runMutation(() =>
					removeItem(removeItemCall.call, {
						invoice_doctype: invoice.doctype,
						invoice_name: invoice.name,
						row_name: rowName,
					}),
				);
				setInvoice(updatedInvoice);
				return;
			}

			const updatedInvoice = await runMutation(() =>
				updateItem(updateItemCall.call, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					row_name: rowName,
					qty,
				}),
			);
			setInvoice(updatedInvoice);
		},
		[invoice, previewLocalCart, removeItemCall.call, runMutation, updateItemCall.call],
	);

	const removeCartItem = useCallback(
		async (rowName: string) => {
			if (!invoice) {
				return;
			}

			if (isLocalCart(invoice)) {
				const nextItems = invoice.items.filter((row) => row.row_name !== rowName);
				if (!nextItems.length) {
					setInvoice(null);
					return;
				}
				const preview = await runMutation(() => previewLocalCart(nextItems, invoice));
				setInvoice(preview);
				return;
			}

			const updatedInvoice = await runMutation(() =>
				removeItem(removeItemCall.call, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					row_name: rowName,
				}),
			);
			setInvoice(updatedInvoice);
		},
		[invoice, previewLocalCart, removeItemCall.call, runMutation],
	);

	const listHeld = useCallback(async () => {
		setIsHeldLoading(true);
		setError(null);
		try {
			const rows = await listHeldInvoices(listHeldInvoicesCall.call, {
				pos_profile: posProfile,
				limit: 20,
			});
			setHeldInvoices(rows);
			return rows;
		} catch (err) {
			console.error(err);
			setError(err instanceof Error ? err.message : "Failed to load held invoices");
			throw err;
		} finally {
			setIsHeldLoading(false);
		}
	}, [listHeldInvoicesCall.call, posProfile]);

	const clearCart = useCallback(async () => {
		if (!invoice?.items?.length) {
			setInvoice(null);
			return;
		}

		const confirmed = window.confirm("Clear all items from the current cart?");
		if (!confirmed) {
			return;
		}

		if (isLocalCart(invoice)) {
			if (invoice.source_invoice_doctype && invoice.source_invoice_name) {
				await runMutation(() =>
					clearInvoice(clearInvoiceCall.call, {
						invoice_doctype: invoice.source_invoice_doctype || "",
						invoice_name: invoice.source_invoice_name || "",
					}),
				);
				await listHeld();
			}
			setInvoice(null);
			return;
		}

		const updatedInvoice = await runMutation(() =>
			clearInvoice(clearInvoiceCall.call, {
				invoice_doctype: invoice.doctype,
				invoice_name: invoice.name,
			}),
		);
		setInvoice(updatedInvoice.items?.length ? updatedInvoice : null);
	}, [clearInvoiceCall.call, invoice, listHeld, runMutation]);

	const resetCart = useCallback(() => {
		setInvoice(null);
		setPrintPayload(null);
		setError(null);
	}, []);

	const syncLocalCartToSource = useCallback(
		async (cart: InvoiceDTO) => {
			if (!cart.source_invoice_doctype || !cart.source_invoice_name) {
				return null;
			}

			return updateInvoiceFromCart(updateInvoiceFromCartCall.call, {
				invoice_doctype: cart.source_invoice_doctype,
				invoice_name: cart.source_invoice_name,
				customer: selectedCustomer?.customer || cart.customer,
				items: cart.items.map((item) => ({
					item_code: item.item_code,
					qty: item.qty,
				})),
			});
		},
		[selectedCustomer?.customer, updateInvoiceFromCartCall.call],
	);

	const submitCart = useCallback(
		async (payments: PaymentInput[], printFormat?: string | null, idempotencyKey?: string) => {
			if (!invoice) {
				return null;
			}

			for (const item of invoice.items) {
				validateAvailableQty(item, item.qty);
			}

			const submittedInvoice = await runMutation(() => {
				if (isLocalCart(invoice)) {
					if (invoice.source_invoice_doctype && invoice.source_invoice_name) {
						return syncLocalCartToSource(invoice).then((updatedInvoice) =>
							checkoutInvoice(checkoutInvoiceCall.call, {
								invoice_doctype: updatedInvoice?.doctype || invoice.source_invoice_doctype || "",
								invoice_name: updatedInvoice?.name || invoice.source_invoice_name || "",
								payments,
								idempotency_key: idempotencyKey,
							}),
						);
					}

					return createInvoiceFromCart(createInvoiceFromCartCall.call, {
						pos_profile: posProfile,
						customer: selectedCustomer?.customer,
						items: invoice.items.map((item) => ({
							item_code: item.item_code,
							qty: item.qty,
						})),
					}).then((draftInvoice) =>
						checkoutInvoice(checkoutInvoiceCall.call, {
							invoice_doctype: draftInvoice.doctype,
							invoice_name: draftInvoice.name,
							payments,
							idempotency_key: idempotencyKey,
						}),
					);
				}

				return checkoutInvoice(checkoutInvoiceCall.call, {
					invoice_doctype: invoice.doctype,
					invoice_name: invoice.name,
					payments,
					idempotency_key: idempotencyKey,
				});
			});

			try {
				const receipt = await renderInvoice(renderInvoiceCall.call, {
					invoice_doctype: submittedInvoice.doctype,
					invoice_name: submittedInvoice.name,
					print_format: printFormat || undefined,
				});
				setPrintPayload(receipt);
				setInvoice(null);
				return { invoice: submittedInvoice, printPayload: receipt };
			} catch (err) {
				console.error(err);
				setInvoice(null);
				return { invoice: submittedInvoice, printPayload: null };
			}
		},
		[
			checkoutInvoiceCall.call,
			createInvoiceFromCartCall.call,
			invoice,
			posProfile,
			renderInvoiceCall.call,
			runMutation,
			selectedCustomer?.customer,
			syncLocalCartToSource,
		],
	);

	const holdCart = useCallback(async () => {
		if (!invoice?.items?.length) {
			return null;
		}

		for (const item of invoice.items) {
			validateAvailableQty(item, item.qty);
		}

		const heldInvoice = await runMutation(() => {
			if (isLocalCart(invoice)) {
				if (invoice.source_invoice_doctype && invoice.source_invoice_name) {
					return syncLocalCartToSource(invoice).then((updatedInvoice) =>
						holdInvoice(holdInvoiceCall.call, {
							invoice_doctype: updatedInvoice?.doctype || invoice.source_invoice_doctype || "",
							invoice_name: updatedInvoice?.name || invoice.source_invoice_name || "",
						}),
					);
				}

				return createInvoiceFromCart(createInvoiceFromCartCall.call, {
					pos_profile: posProfile,
					customer: selectedCustomer?.customer,
					items: invoice.items.map((item) => ({
						item_code: item.item_code,
						qty: item.qty,
					})),
				}).then((draftInvoice) =>
					holdInvoice(holdInvoiceCall.call, {
						invoice_doctype: draftInvoice.doctype,
						invoice_name: draftInvoice.name,
					}),
				);
			}

			return holdInvoice(holdInvoiceCall.call, {
				invoice_doctype: invoice.doctype,
				invoice_name: invoice.name,
			});
		});

		setInvoice(null);
		setPrintPayload(null);
		await listHeld();
		return heldInvoice;
	}, [
		createInvoiceFromCartCall.call,
		holdInvoiceCall.call,
		invoice,
		posProfile,
		runMutation,
		selectedCustomer?.customer,
		listHeld,
		syncLocalCartToSource,
	]);

	const restoreHeldInvoice = useCallback(
		async (heldInvoice: HeldInvoiceDTO) => {
			const restoredInvoice = await runMutation(() =>
				restoreInvoice(restoreInvoiceCall.call, {
					invoice_doctype: heldInvoice.doctype,
					invoice_name: heldInvoice.name,
				}),
			);
			setInvoice(invoiceToLocalCart(restoredInvoice));
			await listHeld();
			return restoredInvoice;
		},
		[listHeld, restoreInvoiceCall.call, runMutation],
	);

	return {
		addCartItem,
		clearCart,
		error,
		heldInvoices,
		holdCart,
		invoice,
		isHeldLoading,
		isMutating,
		listHeld,
		printPayload,
		removeCartItem,
		resetCart,
		restoreHeldInvoice,
		setError,
		submitCart,
		updateCartItemQty,
	};
}
