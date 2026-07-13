import type { QueueEntry } from "../../types";

type InvoiceQueueEntry = Extract<QueueEntry, { type: "create_invoice" }>;
type HoldQueueEntry = Extract<QueueEntry, { type: "hold_invoice" }>;

// Shared by syncEngine.test.ts, syncEngine.volume.test.ts, queueRepository.test.ts,
// queueStore.test.ts. Field-by-field defaults (not a blanket `...overrides` spread)
// deliberately, so overriding one field can't widen `type`/`payload` into a
// mismatched pair now that QueueEntry is a discriminated union.
export function makeInvoiceEntry(overrides: Partial<InvoiceQueueEntry> = {}): QueueEntry {
	return {
		local_id: overrides.local_id ?? "local-1",
		local_ref: overrides.local_ref ?? "POS-TEST-00001",
		idempotency_key: overrides.idempotency_key ?? "idem-1",
		type: "create_invoice",
		schema_version: 1,
		group: overrides.group ?? null,
		status: overrides.status ?? "pending",
		next_retry_at: overrides.next_retry_at ?? null,
		created_at: overrides.created_at ?? "2026-07-10T08:00:00Z",
		attempts: overrides.attempts ?? [],
		payload: overrides.payload ?? {
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100 }],
		},
	};
}

export function makeHoldEntry(overrides: Partial<HoldQueueEntry> = {}): QueueEntry {
	return {
		local_id: overrides.local_id ?? "hold-1",
		local_ref: overrides.local_ref ?? "POS-TEST-HOLD-00001",
		idempotency_key: overrides.idempotency_key ?? "hold-idem-1",
		type: "hold_invoice",
		schema_version: 1,
		group: overrides.group ?? null,
		status: overrides.status ?? "pending",
		next_retry_at: overrides.next_retry_at ?? null,
		created_at: overrides.created_at ?? "2026-07-10T08:00:00Z",
		attempts: overrides.attempts ?? [],
		payload: overrides.payload ?? {
			items: [{ item_code: "ITEM-1", qty: 1 }],
		},
	};
}
