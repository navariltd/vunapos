import { db } from "../db";
import type { CachedCustomer } from "../types";

export const customerRepository = {
	async getAll(): Promise<CachedCustomer[]> {
		return db.customers.toArray();
	},

	async getByName(customer: string): Promise<CachedCustomer | undefined> {
		return db.customers.get(customer);
	},

	async search(query: string, limit = 20): Promise<CachedCustomer[]> {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return (await db.customers.toArray()).slice(0, limit);
		}
		return (await db.customers.toArray())
			.filter((row) => row.customer_name.toLowerCase().includes(needle) || (row.mobile_no ?? "").toLowerCase().includes(needle))
			.slice(0, limit);
	},

	async count(): Promise<number> {
		return db.customers.count();
	},
};
