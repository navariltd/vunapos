import { db } from "../db";
import type { CachedItem } from "../types";

export const itemRepository = {
	async getAll(): Promise<CachedItem[]> {
		return db.items.toArray();
	},

	async getByCode(itemCode: string): Promise<CachedItem | undefined> {
		return db.items.get(itemCode);
	},

	async search(query: string, limit = 50): Promise<CachedItem[]> {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return db.items.limit(limit).toArray();
		}
		const byCode = await db.items.where("item_code").startsWithIgnoreCase(needle).limit(limit).toArray();
		if (byCode.length >= limit) {
			return byCode;
		}
		const seen = new Set(byCode.map((item) => item.item_code));
		const remaining = limit - byCode.length;
		const byName = await db.items
			.filter((item) => item.item_name.toLowerCase().includes(needle) && !seen.has(item.item_code))
			.limit(remaining)
			.toArray();
		return [...byCode, ...byName];
	},

	async getByBarcode(barcode: string): Promise<CachedItem | undefined> {
		return db.items.where("barcode").equals(barcode).first();
	},

	async count(): Promise<number> {
		return db.items.count();
	},
};
