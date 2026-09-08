import { useMemo } from "react";

import { useCartApi } from "./useCartApi";
import { useCartStore } from "../stores/cartStore";
import type { BatchAllocationDTO, CustomerDTO, HeldInvoiceDTO, ItemDTO, PaymentInput, PricingOverrideDTO, SerialAllocationDTO } from "../types";

// Binds useCartApi() (the frappe-react-sdk call functions, must be created inside a
// component) to cartStore's stable action references, exposing today's call surface
// (no `api` param needed at call sites) - matching what usePOSInvoice() used to return.
export function useCartActions() {
	const api = useCartApi();
	const addCartItemAction = useCartStore((s) => s.addCartItem);
	const scanBarcodeAction = useCartStore((s) => s.scanBarcode);
	const updateCartItemQtyAction = useCartStore((s) => s.updateCartItemQty);
	const updateCartItemPricingAction = useCartStore((s) => s.updateCartItemPricing);
	const updateCartItemNoteAction = useCartStore((s) => s.updateCartItemNote);
	const updateCartItemBatchAllocationsAction = useCartStore((s) => s.updateCartItemBatchAllocations);
	const updateCartItemUomAction = useCartStore((s) => s.updateCartItemUom);
	const updateCartItemSerialAllocationsAction = useCartStore((s) => s.updateCartItemSerialAllocations);
	const loadItemBatchesAction = useCartStore((s) => s.loadItemBatches);
	const removeCartItemAction = useCartStore((s) => s.removeCartItem);
	const listHeldAction = useCartStore((s) => s.listHeld);
	const clearCartAction = useCartStore((s) => s.clearCart);
	const validateCartAction = useCartStore((s) => s.validateCart);
	const previewLoyaltyRedemptionAction = useCartStore((s) => s.previewLoyaltyRedemption);
	const refreshCartConfigurationAction = useCartStore((s) => s.refreshCartConfiguration);
	const refreshCustomerPricingAction = useCartStore((s) => s.refreshCustomerPricing);
	const refreshPriceListPricingAction = useCartStore((s) => s.refreshPriceListPricing);
	const submitCartAction = useCartStore((s) => s.submitCart);
	const holdCartAction = useCartStore((s) => s.holdCart);
	const restoreHeldInvoiceAction = useCartStore((s) => s.restoreHeldInvoice);
	const editDraftInvoiceAction = useCartStore((s) => s.editDraftInvoice);

	return useMemo(
		() => ({
			addCartItem: (item: ItemDTO) => addCartItemAction(item, api),
			scanBarcode: (barcode: string) => scanBarcodeAction(barcode, api),
			updateCartItemQty: (rowName: string, qty: number) => updateCartItemQtyAction(rowName, qty, api),
			updateCartItemPricing: (rowName: string, pricingOverride?: PricingOverrideDTO) =>
				updateCartItemPricingAction(rowName, pricingOverride, api),
			updateCartItemNote: (rowName: string, note: string) => updateCartItemNoteAction(rowName, note, api),
			updateCartItemBatchAllocations: (rowName: string, allocations: BatchAllocationDTO[]) =>
				updateCartItemBatchAllocationsAction(rowName, allocations, api),
			updateCartItemUom: (rowName: string, uom: string, conversionFactor: number) =>
				updateCartItemUomAction(rowName, uom, conversionFactor, api),
			updateCartItemSerialAllocations: (rowName: string, allocations: SerialAllocationDTO[]) =>
				updateCartItemSerialAllocationsAction(rowName, allocations, api),
			loadItemBatches: (itemCode: string, warehouse: string, isOnline: boolean) =>
				loadItemBatchesAction(itemCode, warehouse, isOnline, api),
			removeCartItem: (rowName: string, managerPinToken?: string) => removeCartItemAction(rowName, api, managerPinToken),
			listHeld: () => listHeldAction(api),
			clearCart: () => clearCartAction(api),
			validateCart: () => validateCartAction(api),
			previewLoyaltyRedemption: (loyaltyPoints: number) => previewLoyaltyRedemptionAction(loyaltyPoints, api),
			refreshCartConfiguration: () => refreshCartConfigurationAction(api),
			refreshCustomerPricing: (customer: CustomerDTO | null | undefined) =>
				refreshCustomerPricingAction(customer, api),
			refreshPriceListPricing: (priceList?: string) => refreshPriceListPricingAction(priceList, api),
			submitCart: (
				payments: PaymentInput[],
				printFormat: string | null | undefined,
				idempotencyKey?: string,
				isOnline = false,
				isCreditSale = false,
				dueDate?: string,
				loyaltyPoints?: number,
				taxId?: string,
			shippingAddressName?: string,
			checkoutFields?: Record<string, string | number | boolean | null>,
			orderType?: "Sales Invoice" | "Sales Order",
				salesperson?: string,
				salespersonToken?: string,
			) => submitCartAction(
				payments, printFormat, idempotencyKey, api, isOnline, isCreditSale, dueDate, loyaltyPoints, taxId, shippingAddressName, checkoutFields, orderType, salesperson, salespersonToken,
			),
			holdCart: () => holdCartAction(api),
			restoreHeldInvoice: (heldInvoice: HeldInvoiceDTO) => restoreHeldInvoiceAction(heldInvoice, api),
			editDraftInvoice: (doctype: string, name: string) => editDraftInvoiceAction(doctype, name, api),
		}),
		[
			api,
			addCartItemAction,
			scanBarcodeAction,
			updateCartItemQtyAction,
			updateCartItemPricingAction,
			updateCartItemNoteAction,
			updateCartItemBatchAllocationsAction,
			updateCartItemUomAction,
			updateCartItemSerialAllocationsAction,
			loadItemBatchesAction,
			removeCartItemAction,
			listHeldAction,
			clearCartAction,
			validateCartAction,
			previewLoyaltyRedemptionAction,
			refreshCartConfigurationAction,
			refreshCustomerPricingAction,
			refreshPriceListPricingAction,
			submitCartAction,
			holdCartAction,
			restoreHeldInvoiceAction,
		],
	);
}
