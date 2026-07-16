import { META_KEYS, metaRepository } from "./repositories/metaRepository";

// §11.2 / ADR-007: TTL is a refresh trigger, never an expiry. STALE never blocks
// selling (§8.5) - this is a status for the UI indicator, not a gate.
export const DEFAULT_FRESHNESS_TTL_MS = 5 * 60 * 60 * 1000;

export type FreshnessStatus = "empty" | "fresh" | "stale";

export async function getFreshnessStatus(ttlMs: number = DEFAULT_FRESHNESS_TTL_MS): Promise<FreshnessStatus> {
	const lastSync = await metaRepository.get<string>(META_KEYS.lastDeltaSync);
	if (!lastSync) {
		return "empty";
	}
	const age = Date.now() - new Date(lastSync).getTime();
	return age > ttlMs ? "stale" : "fresh";
}
