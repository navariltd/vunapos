import { useEffect } from "react";

import { applyDelta } from "../../../lib/cacheEngine";
import { DEFAULT_FRESHNESS_TTL_MS } from "../../../lib/freshness";
import { useBootstrapSyncStore } from "../../../lib/stores/bootstrapSyncStore";
import { checkReachability, onConnectivityChange } from "../../../lib/stores/connectivityStore";
import { VunaApiError } from "../../../services/vunaApi";

// Hydrates the process-local read cache. Every browser load requires a successful
// server bootstrap; background refreshes only keep the active application current.
export function useBootstrapSync() {
	const phase = useBootstrapSyncStore((s) => s.phase);
	const error = useBootstrapSyncStore((s) => s.error);
	const errorCode = useBootstrapSyncStore((s) => s.errorCode);
	const setPhase = useBootstrapSyncStore((s) => s.setPhase);
	const setError = useBootstrapSyncStore((s) => s.setError);

	useEffect(() => {
		let cancelled = false;
		void applyDelta().then(
			() => { if (!cancelled) setPhase("ready"); },
			(err: unknown) => {
				if (cancelled) return;
				setError(
					err instanceof Error ? err.message : "Failed to load VunaPOS data",
					err instanceof VunaApiError ? err.code : null,
				);
				setPhase("blocked");
			},
		);
		return () => { cancelled = true; };
	}, [setError, setPhase]);

	useEffect(() => {
		void checkReachability();
		const unsubscribe = onConnectivityChange((state) => {
			if (state === "reachable") void refreshInBackground();
		});
		const refreshInterval = window.setInterval(() => void refreshInBackground(), DEFAULT_FRESHNESS_TTL_MS);
		return () => {
			unsubscribe();
			window.clearInterval(refreshInterval);
		};
	}, []);

	return { phase, error, errorCode, retry: () => window.location.reload() };
}

async function refreshInBackground(): Promise<void> {
	try {
		await applyDelta();
	} catch (err) {
		console.error("Background catalogue refresh failed", err);
	}
}
