import { db } from "../db";
import type { CachedCustomer } from "../types";

/** Whether a till limited to these Customer Groups shows the customer; null or empty shows all. */
export function inCustomerGroups(row: Pick<CachedCustomer, "customer_group">, groups?: string[] | null): boolean {
	return !groups?.length || groups.includes(row.customer_group ?? "");
}

export const customerRepository = {
	async getAll(): Promise<CachedCustomer[]> {
		return db.customers.toArray();
	},

	async getByName(customer: string): Promise<CachedCustomer | undefined> {
		return db.customers.get(customer);
	},

	async search(query: string, limit = 20, groups?: string[] | null): Promise<CachedCustomer[]> {
		const needle = query.trim().toLowerCase();
		const rows = (await db.customers.toArray()).filter((row) => inCustomerGroups(row, groups));
		if (!needle) {
			return rows.slice(0, limit);
		}
		return rows
			.filter((row) => row.customer_name.toLowerCase().includes(needle) || (row.mobile_no ?? "").toLowerCase().includes(needle))
			.slice(0, limit);
	},

	async put(customer: CachedCustomer): Promise<void> {
		await db.customers.put(customer);
	},

	async count(): Promise<number> {
		return db.customers.count();
	},
};
