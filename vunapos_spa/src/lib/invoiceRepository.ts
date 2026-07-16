import { assembleCartAgainstCache } from "./cartAssembly";
import type { AssembledInvoice, CartLine } from "./invoiceEngine";
import { META_KEYS, metaRepository } from "./repositories/metaRepository";
import { profileRepository } from "./repositories/profileRepository";
import { queueRepository } from "./repositories/queueRepository";
import type { InvoicePayload, QueueEntry } from "./types";

export type Cart = {
	customer?: string;
	items: CartLine[];
	payments: { mode_of_payment: string; amount: number }[];
};

export type LocalInvoice = {
	local_id: string;
	local_ref: string;
	created_at: string;
	posting_date: string;
	posting_time: string;
	assembled: AssembledInvoice;
};

// Date#toISOString() is always UTC and would silently record the wrong calendar day
// for a till west/east of UTC crossing midnight. These use the Date object's local
// getters instead, matching what the cashier's clock and printed receipt show.
function localDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function localTimeString(date: Date): string {
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${hours}:${minutes}:${seconds}`;
}

// Exported: shared with holdRepository.ts so sales and holds draw from the same
// per-device counter instead of each independently starting at POS-XXXX-00001,
// which would be confusing in the merged Invoices panel / Queue Inspector.
//
// 8 hex chars (32 bits, ~4.3 billion values) rather than 4 (16 bits, 65,536 values) -
// the short version made cross-device local_ref collisions realistic at fleet scale
// (birthday-paradox ~1% chance by ~600 devices), which matters now that local_ref is
// also stored server-side (vunapos_invoice_number_offline). No server round trip needed
// to guarantee this: crypto.randomUUID() already has far more entropy than a device
// fleet could ever exhaust at this width, generated once and cached per device.
export async function getOrCreateDevicePrefix(): Promise<string> {
	const existing = await metaRepository.get<string>(META_KEYS.deviceId);
	if (existing) {
		return existing;
	}
	const prefix = `POS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
	await metaRepository.set(META_KEYS.deviceId, prefix);
	return prefix;
}

export async function nextLocalRef(): Promise<string> {
	const prefix = await getOrCreateDevicePrefix();
	const counter = ((await metaRepository.get<number>(META_KEYS.localCounter)) ?? 0) + 1;
	await metaRepository.set(META_KEYS.localCounter, counter);
	return `${prefix}-${String(counter).padStart(5, "0")}`;
}

// The only entry point to invoice creation (I6) - the UI never talks to the queue
// or the Invoice Engine directly. write to the queue, return a local_id (spec §2.7).
export const invoiceRepository = {
	async create(cart: Cart): Promise<LocalInvoice> {
		if (!cart.items.length) {
			throw new Error("Cannot submit an empty cart");
		}

		const profile = await profileRepository.getActive();
		if (!profile) {
			throw new Error("No active POS profile cached - bootstrap must run before selling");
		}
		if (!cart.customer && !profile.default_customer) {
			// Caught before queuing, not after: the server rejects a missing customer too,
			// but only after the sale is already "sold" from the cashier's view (I1) - this
			// is knowable from cached data alone, so there's no reason to let it round-trip.
			throw new Error("Select a customer, or set a default customer on this POS Profile, before checkout");
		}

		// Assembly happens before any durable write - if pricing/tax data is missing or
		// the engine hits an unsupported shape, it throws here and nothing is queued (I9).
		const assembled = await assembleCartAgainstCache(cart.items, profile);

		const now = new Date();
		const localId = crypto.randomUUID();
		const idempotencyKey = crypto.randomUUID();
		const localRef = await nextLocalRef();
		const postingDate = localDateString(now);
		const postingTime = localTimeString(now);

		// Frozen at enqueue time (I7): everything the server needs, including the
		// device-local sale moment (posting_date/time), not the sync moment. invoice_doctype
		// is resolved explicitly here so the client also knows which doctype to render a
		// receipt for after sync.
		const payload: InvoicePayload = {
			invoice_doctype: profile.invoice_mode || "Sales Invoice",
			pos_profile: profile.name,
			customer: cart.customer,
			items: cart.items,
			payments: cart.payments,
			posting_date: postingDate,
			posting_time: postingTime,
			totals: {
				net_total: assembled.totals.net_total,
				total_taxes_and_charges: assembled.totals.total_taxes_and_charges,
				grand_total: assembled.totals.grand_total,
				rounded_total: assembled.totals.rounded_total,
			},
			local_ref: localRef,
		};

		const entry: QueueEntry = {
			local_id: localId,
			local_ref: localRef,
			idempotency_key: idempotencyKey,
			type: "create_invoice",
			schema_version: 1,
			group: null,
			status: "pending",
			next_retry_at: null,
			created_at: now.toISOString(),
			attempts: [],
			payload,
		};

		await queueRepository.append(entry);

		return {
			local_id: localId,
			local_ref: localRef,
			created_at: entry.created_at,
			posting_date: postingDate,
			posting_time: postingTime,
			assembled,
		};
	},
};
