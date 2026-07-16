import { assembleCartAgainstCache } from "./cartAssembly";
import type { AssembledInvoice, CartLine } from "./invoiceEngine";
import { nextLocalRef } from "./invoiceRepository";
import { profileRepository } from "./repositories/profileRepository";
import { queueRepository } from "./repositories/queueRepository";
import type { HoldPayload, QueueEntry } from "./types";

export type HoldCart = {
	customer?: string;
	items: CartLine[];
};

export type LocalHold = {
	local_id: string;
	local_ref: string;
	created_at: string;
	assembled: AssembledInvoice;
};

// Mirrors invoiceRepository.create(): same immutable, write-once queuing, but no
// payments/posting_date/time since a hold has no "sale moment" until checkout submits
// it. Shares nextLocalRef() with invoiceRepository so sales and holds draw from one
// per-device counter instead of each independently starting at POS-XXXX-00001.
export const holdRepository = {
	async create(cart: HoldCart): Promise<LocalHold> {
		if (!cart.items.length) {
			throw new Error("Cannot hold an empty cart");
		}

		const profile = await profileRepository.getActive();
		if (!profile) {
			throw new Error("No active POS profile cached - bootstrap must run before selling");
		}
		if (!cart.customer && !profile.default_customer) {
			throw new Error("Select a customer, or set a default customer on this POS Profile, before holding");
		}

		// Assembly happens before any durable write - if pricing/tax data is missing or
		// the engine hits an unsupported shape, it throws here and nothing is queued.
		const assembled = await assembleCartAgainstCache(cart.items, profile);

		const now = new Date();
		const localId = crypto.randomUUID();
		const idempotencyKey = crypto.randomUUID();
		const localRef = await nextLocalRef();

		const payload: HoldPayload = {
			invoice_doctype: profile.invoice_mode || "Sales Invoice",
			pos_profile: profile.name,
			customer: cart.customer,
			items: cart.items,
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
			type: "hold_invoice",
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
			assembled,
		};
	},
};
