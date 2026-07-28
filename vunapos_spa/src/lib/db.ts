import type {
	CachedBatchInventory,
	CachedCustomer,
	CachedItem,
	CachedItemTaxTemplate,
	CachedPaymentMode,
	CachedProfile,
	CachedTaxTemplate,
	MetaRow,
} from "./types";

type Key = string;

class MemoryTable<T> {
	private rows = new Map<Key, T>();
	private readonly keyOf: (row: T) => Key;

	constructor(keyOf: (row: T) => Key) {
		this.keyOf = keyOf;
	}

	async clear() { this.rows.clear(); }
	async count() { return this.rows.size; }
	async toArray() { return [...this.rows.values()]; }
	async get(key: Key) { return this.rows.get(key); }
	async put(row: T) { this.rows.set(this.keyOf(row), row); return this.keyOf(row); }
	async bulkPut(rows: T[]) { for (const row of rows) this.rows.set(this.keyOf(row), row); }
	async bulkDelete(keys: Key[]) { for (const key of keys) this.rows.delete(key); }
}

// Process-local read cache only. A reload starts empty and must hydrate from the server.
export const db = {
	items: new MemoryTable<CachedItem>((row) => row.item_code),
	batchInventory: new MemoryTable<CachedBatchInventory>((row) => row.key),
	customers: new MemoryTable<CachedCustomer>((row) => row.customer),
	taxTemplates: new MemoryTable<CachedTaxTemplate>((row) => row.name),
	itemTaxTemplates: new MemoryTable<CachedItemTaxTemplate>((row) => row.name),
	paymentModes: new MemoryTable<CachedPaymentMode>((row) => row.mode_of_payment),
	profile: new MemoryTable<CachedProfile>((row) => row.name),
	meta: new MemoryTable<MetaRow>((row) => row.key),
};

export const MASTER_DATA_TABLES = [
	db.items,
	db.customers,
	db.taxTemplates,
	db.itemTaxTemplates,
	db.paymentModes,
	db.profile,
] as const;
