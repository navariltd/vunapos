import { useMemo } from "react";

import { useCartApi } from "./useCartApi";
import { useCartStore } from "../stores/cartStore";
import type { HeldInvoiceDTO, ItemDTO, PaymentInput } from "../types";

// Binds useCartApi() (the frappe-react-sdk call functions, must be created inside a
// component) to cartStore's stable action references, exposing today's call surface
// (no `api` param needed at call sites) - matching what usePOSInvoice() used to return.
export function useCartActions() {
	const api = useCartApi();
	const addCartItemAction = useCartStore((s) => s.addCartItem);
	const updateCartItemQtyAction = useCartStore((s) => s.updateCartItemQty);
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
			removeCartItem: (rowName: string) => removeCartItemAction(rowName, api),
			listHeld: () => listHeldAction(api),
			clearCart: () => clearCartAction(api),
			submitCart: (payments: PaymentInput[], printFormat: string | null | undefined, idempotencyKey?: string) =>
				submitCartAction(payments, printFormat, idempotencyKey, api),
			holdCart: () => holdCartAction(api),
			restoreHeldInvoice: (heldInvoice: HeldInvoiceDTO) => restoreHeldInvoiceAction(heldInvoice, api),
			restoreLocalHold: (localId: string) => restoreLocalHoldAction(localId, api),
		}),
		[
			api,
			addCartItemAction,
			updateCartItemQtyAction,
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
