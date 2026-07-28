import { db } from "../db";
import type { CachedItem } from "../types";

export const itemRepository = {
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

	async search(query: string, limit = 50): Promise<CachedItem[]> {
		const needle = query.trim().toLowerCase();
		const items = await db.items.toArray();
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
