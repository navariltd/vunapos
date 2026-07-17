import { META_KEYS, metaRepository } from "./repositories/metaRepository";

// F10 mitigation (§14.3): asks the browser not to silently evict this origin's
// IndexedDB under storage pressure. Reduces but doesn't eliminate the risk of losing
// unsynced sales to storage clearing - that remains a real, unsolved gap (F10).
// Result is recorded in meta for future diagnostics (no diagnostics screen yet).
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.storage?.persist) {
		await metaRepository.set(META_KEYS.storagePersisted, false);
		return false;
	}
	let granted = false;
	try {
		granted = await navigator.storage.persist();
	} catch (err) {
		console.error("navigator.storage.persist() failed", err);
	}
	await metaRepository.set(META_KEYS.storagePersisted, granted);
	return granted;
}
