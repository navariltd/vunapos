import Dexie, { type EntityTable } from "dexie";

import type {
	CachedCustomer,
	CachedItem,
	CachedItemTaxTemplate,
	CachedPaymentMode,
	CachedProfile,
	CachedTaxTemplate,
	MetaRow,
	QueueEntry,
	QueueMapping,
} from "./types";

// Dexie schema v1. Index lists only fields we actually query/filter by -
// see the source-of-truth table in the spec (§5/§6) for why each table exists.
export const db = new Dexie("vunapos") as Dexie & {
	items: EntityTable<CachedItem, "item_code">;
	customers: EntityTable<CachedCustomer, "customer">;
	taxTemplates: EntityTable<CachedTaxTemplate, "name">;
	itemTaxTemplates: EntityTable<CachedItemTaxTemplate, "name">;
	paymentModes: EntityTable<CachedPaymentMode, "mode_of_payment">;
	profile: EntityTable<CachedProfile, "name">;
	meta: EntityTable<MetaRow, "key">;
	queue: EntityTable<QueueEntry, "local_id">;
	mappings: EntityTable<QueueMapping, "local_id">;
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

export const MASTER_DATA_TABLES = [
	db.items,
	db.customers,
	db.taxTemplates,
	db.itemTaxTemplates,
	db.paymentModes,
	db.profile,
] as const;
