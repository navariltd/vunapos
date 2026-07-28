import type { ItemDTO } from "../features/pos/types";
import type { QueueEntry } from "./types";

export function pendingSaleQuantities(entries: QueueEntry[]): Map<string, number> {
	const quantities = new Map<string, number>();
	for (const entry of entries) {
		if (entry.type !== "create_invoice" || (entry.status !== "pending" && entry.status !== "syncing")) continue;
		for (const item of entry.payload.items) {
			quantities.set(item.item_code, (quantities.get(item.item_code) || 0) + Number(item.qty || 0) * Number(item.conversion_factor || 1));
		}
	}
	return quantities;
}

export function applyPendingStock(items: ItemDTO[], entries: QueueEntry[]): ItemDTO[] {
	const pending = pendingSaleQuantities(entries);
	if (!pending.size) return items;
	return items.map((item) => {
		const pendingQty = pending.get(item.item_code) || 0;
		if (!pendingQty || item.actual_qty === undefined || item.actual_qty === null) return item;
		return { ...item, actual_qty: Math.max(Number(item.actual_qty) - pendingQty, 0) };
	});
}
