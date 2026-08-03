import { fetchBootstrap } from "./apiClient";
import { db } from "./db";
import { META_KEYS, metaRepository } from "./repositories/metaRepository";
import { profileRepository } from "./repositories/profileRepository";
import { useRuntimeCacheStore } from "./stores/runtimeCacheStore";
import type { BootstrapPayload, CachedPosSession } from "./types";

export class BootstrapVerificationError extends Error { }

export async function cachePosSession(session: CachedPosSession): Promise<void> {
	await metaRepository.set(META_KEYS.posSession, session);
}

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
	if (!payload.pos_session || payload.pos_session.pos_profile !== payload.pos_profile.name) {
		throw new BootstrapVerificationError("Bootstrap payload has no verified POS session status");
	}
}

async function writeFullSnapshot(payload: BootstrapPayload): Promise<void> {
	await Promise.all([
		db.items.clear(), db.customers.clear(), db.taxTemplates.clear(), db.itemTaxTemplates.clear(),
		db.paymentModes.clear(), db.profile.clear(), db.meta.clear(),
	]);
	await Promise.all([
		db.items.bulkPut(payload.items), db.customers.bulkPut(payload.customers),
		db.taxTemplates.bulkPut(payload.tax_templates), db.itemTaxTemplates.bulkPut(payload.item_tax_templates),
		db.paymentModes.bulkPut(payload.payment_modes), db.profile.put(payload.pos_profile),
	]);
	await Promise.all([
		db.meta.put({ key: META_KEYS.lastFullSync, value: payload.server_time }),
		db.meta.put({ key: META_KEYS.lastDeltaSync, value: payload.server_time }),
		db.meta.put({ key: META_KEYS.bootstrapVersion, value: payload.bootstrap_version }),
		db.meta.put({ key: META_KEYS.taxSettings, value: payload.tax_settings }),
		db.meta.put({ key: META_KEYS.posSession, value: payload.pos_session }),
	]);
	useRuntimeCacheStore.getState().touch();
}

async function writeDelta(payload: BootstrapPayload): Promise<void> {
	await (async () => {
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
		await db.meta.put({ key: META_KEYS.posSession, value: payload.pos_session });
	})();
	useRuntimeCacheStore.getState().touch();
}

export async function hydrate(posProfile?: string): Promise<BootstrapPayload> {
	const payload = await fetchBootstrap(posProfile);
	verify(payload);
	await writeFullSnapshot(payload);
	return payload;
}

export async function applyDelta(posProfile?: string): Promise<BootstrapPayload> {
	const activePosProfile = posProfile || (await profileRepository.getActive())?.name;
	const since = await metaRepository.get<string>(META_KEYS.lastDeltaSync);
	if (!since) {
		// No prior sync to delta against - the first sync of a device's life is always full (§10.1).
		return hydrate(activePosProfile);
	}

	const lastKnownVersion = await metaRepository.get<number>(META_KEYS.bootstrapVersion);
	const delta = await fetchBootstrap(activePosProfile, since);

	if (lastKnownVersion !== undefined && delta.bootstrap_version !== lastKnownVersion) {
		// BootstrapVersionBumped (§9.1): a delta against a superseded dependency set isn't
		// safe to trust - re-hydrate fully instead of reconciling around the gap.
		return hydrate(activePosProfile);
	}

	await writeDelta(delta);
	return delta;
}
