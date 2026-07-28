import { useMemo } from "react";

import { useCartApi } from "./useCartApi";
import { useCartStore } from "../stores/cartStore";
import type { BatchAllocationDTO, HeldInvoiceDTO, ItemDTO, PaymentInput, PricingOverrideDTO, SerialAllocationDTO } from "../types";

// Binds useCartApi() (the frappe-react-sdk call functions, must be created inside a
// component) to cartStore's stable action references, exposing today's call surface
// (no `api` param needed at call sites) - matching what usePOSInvoice() used to return.
export function useCartActions() {
	const api = useCartApi();
	const addCartItemAction = useCartStore((s) => s.addCartItem);
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
	const submitCartAction = useCartStore((s) => s.submitCart);
	const holdCartAction = useCartStore((s) => s.holdCart);
	const restoreHeldInvoiceAction = useCartStore((s) => s.restoreHeldInvoice);
	const restoreLocalHoldAction = useCartStore((s) => s.restoreLocalHold);

	return useMemo(
		() => ({
			addCartItem: (item: ItemDTO) => addCartItemAction(item, api),
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
			removeCartItem: (rowName: string) => removeCartItemAction(rowName, api),
			listHeld: () => listHeldAction(api),
			clearCart: () => clearCartAction(api),
			submitCart: (
				payments: PaymentInput[],
				printFormat: string | null | undefined,
				idempotencyKey?: string,
				isOnline = false,
			) => submitCartAction(payments, printFormat, idempotencyKey, api, isOnline),
			holdCart: () => holdCartAction(api),
			restoreHeldInvoice: (heldInvoice: HeldInvoiceDTO) => restoreHeldInvoiceAction(heldInvoice, api),
			restoreLocalHold: (localId: string) => restoreLocalHoldAction(localId, api),
		}),
		[
			api,
			addCartItemAction,
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
			submitCartAction,
			holdCartAction,
			restoreHeldInvoiceAction,
			restoreLocalHoldAction,
		],
	);
}
