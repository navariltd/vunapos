import { useEffect } from "react";

import { applyDelta, hydrateConfig } from "../../../lib/cacheEngine";
import { DEFAULT_FRESHNESS_TTL_MS } from "../../../lib/freshness";
import { useBootstrapSyncStore } from "../../../lib/stores/bootstrapSyncStore";
import {
	checkReachability,
	onConnectivityChange,
	type ConnectivityState,
} from "../../../lib/stores/connectivityStore";
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
		let configurationReady = false;

		// Fetch the small profile/session payload separately so the shell can become
		// interactive immediately. The full catalogue starts at the same time and
		// updates the in-memory cache as soon as it completes.
		void hydrateConfig().then(
			() => {
				if (cancelled) return;
				configurationReady = true;
				setPhase("ready");
			},
			(err: unknown) => {
				if (cancelled) return;
				setError(
					err instanceof Error ? err.message : "Failed to load VunaPOS configuration",
					err instanceof VunaApiError ? err.code : null,
				);
				setPhase("blocked");
			},
		);
		void (async () => {
			try {
				await applyDelta();
				if (!cancelled && !configurationReady) setPhase("ready");
			} catch (err: unknown) {
				// A catalogue failure must not hide the already usable POS shell. The
				// regular background refresh will retry it without losing the session.
				if (!cancelled && !configurationReady) {
					try {
						await hydrateConfig();
						configurationReady = true;
						setPhase("ready");
					} catch (configError: unknown) {
						setError(
							configError instanceof Error ? configError.message : "Failed to load VunaPOS data",
							configError instanceof VunaApiError ? configError.code : null,
						);
						setPhase("blocked");
					}
				}
				if (configurationReady) console.error("Initial catalogue refresh failed", err);
			}
		})();
		return () => { cancelled = true; };
	}, [setError, setPhase]);

	useEffect(() => {
		void checkReachability();
		let previousConnectivityState: ConnectivityState | null = null;
		let authenticationExpired = false;
		const refresh = () => {
			if (authenticationExpired) return;
			void refreshInBackground(() => {
				authenticationExpired = true;
				setError("Your session has expired. Sign in again to continue.", "AUTHENTICATION_REQUIRED");
				setPhase("blocked");
			});
		};
		const unsubscribe = onConnectivityChange((state) => {
			// A health check reports "reachable" on every interval. Refresh only
			// when the browser actually recovers from an unavailable state.
			const recovered = state === "reachable" && previousConnectivityState !== "reachable";
			previousConnectivityState = state;
			if (recovered) refresh();
		});
		const refreshInterval = window.setInterval(refresh, DEFAULT_FRESHNESS_TTL_MS);
		return () => {
			unsubscribe();
			window.clearInterval(refreshInterval);
		};
	}, []);

	return { phase, error, errorCode, retry: () => window.location.reload() };
}

async function refreshInBackground(onAuthenticationExpired?: () => void): Promise<void> {
	try {
		await applyDelta();
	} catch (err) {
		if (isAuthenticationError(err)) {
			onAuthenticationExpired?.();
			return;
		}
		console.error("Background catalogue refresh failed", err);
	}
}

function isAuthenticationError(err: unknown): boolean {
	if (!(err instanceof VunaApiError)) return false;
	return err.code === "HTTP_401" || err.code === "AuthenticationError" || err.code === "NotLoggedIn";
}
