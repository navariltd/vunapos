import { create } from "zustand";

import { pingServer } from "../apiClient";

// navigator.onLine reflects NIC state, not server reachability (a killed backend still
// reports `true`). "Reachable" here means we've actually heard back from Frappe - via a
// health-check ping or another successful server request.
export type ConnectivityState = "unknown" | "checking" | "reachable" | "unreachable";

type ConnectivityStore = {
	state: ConnectivityState;
	failedChecks: number;
	reportReachable: () => void;
	checkReachability: () => Promise<ConnectivityState>;
};

export const useConnectivityStore = create<ConnectivityStore>((set, get) => ({
	state: "unknown",
	failedChecks: 0,
	// A successful application request is stronger proof of reachability than a separate ping.
	reportReachable: () => set({ state: "reachable", failedChecks: 0 }),
	checkReachability: async () => {
		const previousState = get().state;
		// Do not briefly turn a known-good connection into "checking". Consumers
		// use this state to disable actions, so doing that on every 30-second ping
		// creates false offline prompts during a normal request round-trip.
		if (previousState !== "reachable") set({ state: "checking" });
		try {
			await pingServer();
			set({ state: "reachable", failedChecks: 0 });
		} catch {
			const failedChecks = get().failedChecks + 1;
			const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
			// A single failed health check is often a transient timeout. Preserve a
			// previously reachable state and only mark it unavailable after a second
			// failure (or an explicit browser offline event).
			if (previousState === "reachable" && failedChecks < 2 && !browserOffline) {
				set({ failedChecks });
				return get().state;
			}
			set({ state: "unreachable", failedChecks });
		}
		return get().state;
	},
}));

// Vanilla, non-React entry points let bootstrap timers and event handlers use the
// connectivity state without requiring a mounted React component.
export const getConnectivityState = (): ConnectivityState => useConnectivityStore.getState().state;
export const reportReachable = (): void => useConnectivityStore.getState().reportReachable();
export const checkReachability = (): Promise<ConnectivityState> =>
	useConnectivityStore.getState().checkReachability();

// Subscription adapter used by the bootstrap refresh and connectivity monitor.
export function onConnectivityChange(listener: (state: ConnectivityState) => void): () => void {
	return useConnectivityStore.subscribe((s) => listener(s.state));
}
