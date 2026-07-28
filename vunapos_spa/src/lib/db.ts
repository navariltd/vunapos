import Dexie, { type EntityTable } from "dexie";

import type {
	CachedCustomer,
	CachedBatchInventory,
	CachedItem,
	CachedItemTaxTemplate,
	CachedPaymentMode,
	CachedProfile,
	CachedTaxTemplate,
	MetaRow,
} from "./types";

// Dexie schema v1. Index lists only fields we actually query/filter by -
// see the source-of-truth table in the spec (§5/§6) for why each table exists.
export const db = new Dexie("vunapos") as Dexie & {
	items: EntityTable<CachedItem, "item_code">;
	batchInventory: EntityTable<CachedBatchInventory, "key">;
	customers: EntityTable<CachedCustomer, "customer">;
	taxTemplates: EntityTable<CachedTaxTemplate, "name">;
	itemTaxTemplates: EntityTable<CachedItemTaxTemplate, "name">;
	paymentModes: EntityTable<CachedPaymentMode, "mode_of_payment">;
	profile: EntityTable<CachedProfile, "name">;
	meta: EntityTable<MetaRow, "key">;
};

db.version(1).stores({
	items: "item_code, item_name, barcode, modified",
	customers: "customer, customer_name, mobile_no, customer_group, modified",
	taxTemplates: "name, modified",
	paymentModes: "mode_of_payment",
	profile: "name",
	meta: "key",
	queue: "local_id, idempotency_key, status, next_retry_at, created_at, group",
	mappings: "local_id, server_name",
});

// v2 (N9): item-level tax templates, synced alongside the existing profile-level
// Sales Taxes and Charges Template - see invoiceEngine.ts for why both exist.
db.version(2).stores({
	itemTaxTemplates: "name, modified",
});

// v3: batch availability is cached on demand per profile/warehouse/item. It is
// deliberately separate from the master Item snapshot because batch stock changes
// much more frequently and can be absent without making the item catalog unusable.
db.version(3).stores({
	batchInventory: "key, pos_profile, warehouse, item_code, verified_at",
});

// v4 removes the offline transaction queue. Sales and holds are now created on
// the server immediately, so legacy device-only entries are intentionally dropped.
db.version(4).stores({
	queue: null,
	mappings: null,
});

export const MASTER_DATA_TABLES = [
	db.items,
	db.customers,
	db.taxTemplates,
	db.itemTaxTemplates,
	db.paymentModes,
	db.profile,
] as const;
