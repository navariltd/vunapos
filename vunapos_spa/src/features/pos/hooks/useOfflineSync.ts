import { useEffect } from "react";

import { applyDelta } from "../../../lib/cacheEngine";
import { DEFAULT_FRESHNESS_TTL_MS } from "../../../lib/freshness";
import { itemRepository } from "../../../lib/repositories/itemRepository";
import { requestPersistentStorage } from "../../../lib/storagePersistence";
import { useBootstrapSyncStore } from "../../../lib/stores/bootstrapSyncStore";
import { checkReachability, onConnectivityChange } from "../../../lib/stores/connectivityStore";
import { drainQueue } from "../../../lib/syncEngine";
import { VunaApiError } from "../../../services/vunaApi";

const DRAIN_INTERVAL_MS = 15_000;

// The only legitimate hard block is empty cache + unreachable server on first boot -
// any other bootstrap failure with existing cached data still reaches "ready" (stale),
// since a failed refresh must never stop selling.
export function useOfflineSync() {
	const phase = useBootstrapSyncStore((s) => s.phase);
	const error = useBootstrapSyncStore((s) => s.error);
	const errorCode = useBootstrapSyncStore((s) => s.errorCode);
	const setPhase = useBootstrapSyncStore((s) => s.setPhase);
	const setError = useBootstrapSyncStore((s) => s.setError);

	useEffect(() => {
		let cancelled = false;

		async function bootstrap() {
			void requestPersistentStorage();
			try {
				await applyDelta();
				if (!cancelled) {
					setPhase("ready");
				}
			} catch (err) {
				if (cancelled) {
					return;
				}
				const cachedItemCount = await itemRepository.count();
				if (cachedItemCount > 0) {
					setPhase("ready");
					return;
				}
				setError(
					err instanceof Error ? err.message : "Failed to load offline data",
					err instanceof VunaApiError ? err.code : null,
				);
				setPhase("blocked");
			}
		}

		void bootstrap();
		return () => {
			cancelled = true;
		};
	}, [setError, setPhase]);

	useEffect(() => {
		void checkReachability();

		const unsubscribe = onConnectivityChange((state) => {
			if (state === "reachable") {
				// Drain before refresh: upload pending sales before freshening the catalog.
				// force:true since reachability just regained overrides whatever backoff
				// schedule was computed while offline.
				void drainQueue({ force: true }).then(() => refreshInBackground());
			}
		});

		const drainInterval = window.setInterval(() => void drainQueue(), DRAIN_INTERVAL_MS);
		const refreshInterval = window.setInterval(() => void refreshInBackground(), DEFAULT_FRESHNESS_TTL_MS);

		return () => {
			unsubscribe();
			window.clearInterval(drainInterval);
			window.clearInterval(refreshInterval);
		};
	}, []);

	return { phase, error, errorCode, retry: () => window.location.reload() };
}

// Background refreshes (periodic TTL tick, reconnect) must never throw unhandled -
// a failed refresh just means the cache stays STALE until the next attempt.
async function refreshInBackground(): Promise<void> {
	try {
		await applyDelta();
	} catch (err) {
		console.error("Background cache refresh failed", err);
	}
}
