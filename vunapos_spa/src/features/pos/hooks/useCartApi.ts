import { useFrappePostCall } from "frappe-react-sdk";

import { vunaMethods } from "../../../services/vunaApi";
import type { CartApi } from "../stores/cartStore";

// The only place useFrappePostCall appears for cart/checkout - cartStore.ts takes a
// CartApi of plain functions instead, so it stays testable with plain vi.fn()s.
export function useCartApi(): CartApi {
	const addItemCall = useFrappePostCall(vunaMethods.addItem);
	const getItemDetailsCall = useFrappePostCall(vunaMethods.getItemDetails);
	const searchItemsCall = useFrappePostCall(vunaMethods.searchItems);
	const resolveBarcodeCall = useFrappePostCall(vunaMethods.resolveBarcode);
	const getItemBatchesCall = useFrappePostCall(vunaMethods.getItemBatches);
	const updateItemCall = useFrappePostCall(vunaMethods.updateItem);
	const removeItemCall = useFrappePostCall(vunaMethods.removeItem);
	const clearInvoiceCall = useFrappePostCall(vunaMethods.clearInvoice);
	const createInvoiceFromCartCall = useFrappePostCall(vunaMethods.createInvoiceFromCart);
	const previewInvoiceCall = useFrappePostCall(vunaMethods.previewInvoice);
	const createAndSubmitInvoiceCall = useFrappePostCall(vunaMethods.createAndSubmitInvoice);
	const createAndSubmitSalesOrderCall = useFrappePostCall(vunaMethods.createAndSubmitSalesOrder);
	const checkoutInvoiceCall = useFrappePostCall(vunaMethods.checkoutInvoice);
	const holdInvoiceCall = useFrappePostCall(vunaMethods.holdInvoice);
	const listHeldInvoicesCall = useFrappePostCall(vunaMethods.listHeldInvoices);
	const restoreInvoiceCall = useFrappePostCall(vunaMethods.restoreInvoice);
	const updateInvoiceFromCartCall = useFrappePostCall(vunaMethods.updateInvoiceFromCart);
	const renderInvoiceCall = useFrappePostCall(vunaMethods.renderInvoice);

	return {
		addItem: addItemCall.call,
		getItemDetails: getItemDetailsCall.call,
		searchItems: searchItemsCall.call,
		resolveBarcode: resolveBarcodeCall.call,
		getItemBatches: getItemBatchesCall.call,
		updateItem: updateItemCall.call,
		removeItem: removeItemCall.call,
		clearInvoice: clearInvoiceCall.call,
		createInvoiceFromCart: createInvoiceFromCartCall.call,
		previewInvoice: previewInvoiceCall.call,
		createAndSubmitInvoice: createAndSubmitInvoiceCall.call,
		createAndSubmitSalesOrder: createAndSubmitSalesOrderCall.call,
		checkoutInvoice: checkoutInvoiceCall.call,
		holdInvoice: holdInvoiceCall.call,
		listHeldInvoices: listHeldInvoicesCall.call,
		restoreInvoice: restoreInvoiceCall.call,
		updateInvoiceFromCart: updateInvoiceFromCartCall.call,
		renderInvoice: renderInvoiceCall.call,
	};
}
