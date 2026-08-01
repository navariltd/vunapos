import { db } from "../db";
import type { CachedItem } from "../types";

function isUnavailable(item: CachedItem): boolean {
	return Boolean(item.is_stock_item ?? true)
		&& !item.allow_negative_stock
		&& item.actual_qty !== undefined
		&& item.actual_qty !== null
		&& Number(item.actual_qty || 0) <= 0;
}

export const itemRepository = {
	async replaceAll(items: Array<Omit<CachedItem, "modified"> & { modified?: string }>): Promise<void> {
		await db.items.clear();
		await db.items.bulkPut(items.map((item) => ({ ...item, modified: item.modified || "" })));
	},

	async getAll(): Promise<CachedItem[]> {
		return db.items.toArray();
	},

	async getByCode(itemCode: string): Promise<CachedItem | undefined> {
		return db.items.get(itemCode);
	},

	async updateActualQty(itemCode: string, actualQty: number | null | undefined): Promise<void> {
		const item = await db.items.get(itemCode);
		if (!item) return;
		await db.items.put({ ...item, actual_qty: actualQty });
	},

	async search(query: string, limit = 50, options?: { hideUnavailable?: boolean }): Promise<CachedItem[]> {
		const needle = query.trim().toLowerCase();
		const items = (await db.items.toArray()).filter((item) => !options?.hideUnavailable || !isUnavailable(item));
		if (!needle) return items.slice(0, limit);
		return items
			.filter((item) => item.item_code.toLowerCase().includes(needle) || item.item_name.toLowerCase().includes(needle))
			.sort((a, b) => Number(b.item_code.toLowerCase().startsWith(needle)) - Number(a.item_code.toLowerCase().startsWith(needle)))
			.slice(0, limit);
	},

	async getByBarcode(barcode: string): Promise<CachedItem | undefined> {
		return (await db.items.toArray()).find((item) => item.barcode === barcode);
	},

	async count(): Promise<number> {
		return db.items.count();
	},
};
