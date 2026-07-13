import { useQueueStore } from "../../../lib/stores/queueStore";
import type { QueueEntry } from "../../../lib/types";
import type { HeldInvoiceDTO } from "../types";
import { useCartStore } from "../stores/cartStore";

// Composed at the hook layer, not inside cartStore/queueStore - neither store may
// import the other. A local hold drops out here once synced and reappears via the
// server-side listHeld() path, so it's never shown twice.
export function mergeHeldInvoices(serverHeld: HeldInvoiceDTO[], queueEntries: QueueEntry[]): HeldInvoiceDTO[] {
	const localHolds: HeldInvoiceDTO[] = queueEntries
		.filter((entry): entry is Extract<QueueEntry, { type: "hold_invoice" }> => entry.type === "hold_invoice")
		.filter((entry) => entry.status !== "succeeded" && entry.status !== "archived")
		.map((entry) => ({
			doctype: entry.payload.invoice_doctype || "Sales Invoice",
			name: entry.local_ref,
			customer: entry.payload.customer,
			customer_name: entry.payload.customer,
			modified: entry.created_at,
			grand_total: entry.payload.totals?.grand_total,
			rounded_total: entry.payload.totals?.rounded_total,
			total: entry.payload.totals?.rounded_total ?? entry.payload.totals?.grand_total,
			is_local: true,
			local_id: entry.local_id,
			queue_status: entry.status === "error" ? "error" : "pending",
		}));

	return [...localHolds, ...serverHeld];
}

export function useHeldInvoicesView(): HeldInvoiceDTO[] {
	const serverHeld = useCartStore((s) => s.heldInvoices);
	const queueEntries = useQueueStore((s) => s.entries);
	return mergeHeldInvoices(serverHeld, queueEntries);
}
