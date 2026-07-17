import { fetchBootstrap } from "./apiClient";
import { db, MASTER_DATA_TABLES } from "./db";
import { META_KEYS, metaRepository } from "./repositories/metaRepository";
import type { BootstrapPayload } from "./types";

export class BootstrapVerificationError extends Error {}

// Sanity thresholds before Ready is shown (§10.1 Verify step) - catches a bootstrap
// response that "succeeded" but is missing something a sale can't happen without.
function verify(payload: BootstrapPayload): void {
	if (!payload.pos_profile?.name) {
		throw new BootstrapVerificationError("Bootstrap payload is missing a POS profile");
	}
	if (payload.items.length < 1) {
		throw new BootstrapVerificationError("Bootstrap payload has no sellable items");
	}
	if (payload.payment_modes.length < 1) {
		throw new BootstrapVerificationError("Bootstrap payload has no payment modes");
	}
}

const ALL_TABLES = [...MASTER_DATA_TABLES, db.meta];

// One Dexie transaction, full replace: a failure partway through leaves the previous
// cache fully intact (IndexedDB rolls the whole transaction back) - never a half-cache (I12).
async function writeFullSnapshot(payload: BootstrapPayload): Promise<void> {
	await db.transaction("rw", ALL_TABLES, async () => {
		await db.items.clear();
		await db.items.bulkPut(payload.items);
		await db.customers.clear();
		await db.customers.bulkPut(payload.customers);
		await db.taxTemplates.clear();
		await db.taxTemplates.bulkPut(payload.tax_templates);
		await db.itemTaxTemplates.clear();
		await db.itemTaxTemplates.bulkPut(payload.item_tax_templates);
		await db.paymentModes.clear();
		await db.paymentModes.bulkPut(payload.payment_modes);
		await db.profile.clear();
		await db.profile.put(payload.pos_profile);
		await db.meta.put({ key: META_KEYS.lastFullSync, value: payload.server_time });
		await db.meta.put({ key: META_KEYS.lastDeltaSync, value: payload.server_time });
		await db.meta.put({ key: META_KEYS.bootstrapVersion, value: payload.bootstrap_version });
		await db.meta.put({ key: META_KEYS.taxSettings, value: payload.tax_settings });
	});
}

async function writeDelta(payload: BootstrapPayload): Promise<void> {
	await db.transaction("rw", ALL_TABLES, async () => {
		if (payload.items.length) {
			await db.items.bulkPut(payload.items);
		}
		if (payload.customers.length) {
			await db.customers.bulkPut(payload.customers);
		}
		if (payload.tax_templates.length) {
			await db.taxTemplates.bulkPut(payload.tax_templates);
		}
		if (payload.item_tax_templates.length) {
			await db.itemTaxTemplates.bulkPut(payload.item_tax_templates);
		}
		// Payment modes and the profile are always sent in full (no server-side delta
		// filtering for these small sets), so a delta always replaces them wholesale.
		await db.paymentModes.clear();
		await db.paymentModes.bulkPut(payload.payment_modes);
		await db.profile.clear();
		await db.profile.put(payload.pos_profile);

		const deletedItems = payload.deleted?.Item ?? [];
		if (deletedItems.length) {
			await db.items.bulkDelete(deletedItems);
		}
		const deletedCustomers = payload.deleted?.Customer ?? [];
		if (deletedCustomers.length) {
			await db.customers.bulkDelete(deletedCustomers);
		}

		await db.meta.put({ key: META_KEYS.lastDeltaSync, value: payload.server_time });
		await db.meta.put({ key: META_KEYS.bootstrapVersion, value: payload.bootstrap_version });
		await db.meta.put({ key: META_KEYS.taxSettings, value: payload.tax_settings });
	});
}

export async function hydrate(posProfile?: string): Promise<BootstrapPayload> {
	const payload = await fetchBootstrap(posProfile);
	verify(payload);
	await writeFullSnapshot(payload);
	return payload;
}

export async function applyDelta(posProfile?: string): Promise<BootstrapPayload> {
	const since = await metaRepository.get<string>(META_KEYS.lastDeltaSync);
	if (!since) {
		// No prior sync to delta against - the first sync of a device's life is always full (§10.1).
		return hydrate(posProfile);
	}

	const lastKnownVersion = await metaRepository.get<number>(META_KEYS.bootstrapVersion);
	const delta = await fetchBootstrap(posProfile, since);

	if (lastKnownVersion !== undefined && delta.bootstrap_version !== lastKnownVersion) {
		// BootstrapVersionBumped (§9.1): a delta against a superseded dependency set isn't
		// safe to trust - re-hydrate fully instead of reconciling around the gap.
		return hydrate(posProfile);
	}

	await writeDelta(delta);
	return delta;
}
