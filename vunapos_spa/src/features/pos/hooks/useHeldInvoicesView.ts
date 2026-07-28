import type { HeldInvoiceDTO } from "../types";
import { useCartStore } from "../stores/cartStore";

export function useHeldInvoicesView(): HeldInvoiceDTO[] {
	return useCartStore((s) => s.heldInvoices);
}
