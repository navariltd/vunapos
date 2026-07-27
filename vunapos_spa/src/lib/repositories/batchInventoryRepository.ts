import { db } from "../db";
import type { CachedBatchInventory } from "../types";

function key(posProfile: string, warehouse: string, itemCode: string) {
	return `${posProfile}::${warehouse}::${itemCode}`;
}

export const batchInventoryRepository = {
	async get(posProfile: string, warehouse: string, itemCode: string) {
		return db.batchInventory.get(key(posProfile, warehouse, itemCode));
	},

	async put(inventory: Omit<CachedBatchInventory, "key">) {
		const row = { ...inventory, key: key(inventory.pos_profile, inventory.warehouse, inventory.item_code) };
		await db.batchInventory.put(row);
		return row;
	},
};
