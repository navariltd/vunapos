import { create } from "zustand";

import { pingServer } from "../apiClient";

// navigator.onLine reflects NIC state, not server reachability (a killed backend still
// reports `true`). "Reachable" here means we've actually heard back from Frappe - via a
// health-check ping or any successful sync (a drainQueue upload counts too, cheaper than a redundant ping).
export type ConnectivityState = "unknown" | "checking" | "reachable" | "unreachable";

type ConnectivityStore = {
	state: ConnectivityState;
	reportReachable: () => void;
	checkReachability: () => Promise<ConnectivityState>;
};

export const useConnectivityStore = create<ConnectivityStore>((set, get) => ({
	state: "unknown",
	// Call this whenever a sync succeeds - a successful upload is stronger proof than a ping.
	reportReachable: () => set({ state: "reachable" }),
	checkReachability: async () => {
		set({ state: "checking" });
		try {
			await pingServer();
			set({ state: "reachable" });
		} catch {
			set({ state: "unreachable" });
		}
		return get().state;
	},
}));

// Vanilla, non-React entry points - getState()/setState()/subscribe() need no
// component mounted, so plain modules (syncEngine.ts, called from timers, other
// tabs, or a plain click handler) can call these directly, never the hook itself.
export const getConnectivityState = (): ConnectivityState => useConnectivityStore.getState().state;
export const reportReachable = (): void => useConnectivityStore.getState().reportReachable();
export const checkReachability = (): Promise<ConnectivityState> =>
	useConnectivityStore.getState().checkReachability();

// Back-compat adapter for the old connectivity.ts's (state) => void subscription
// signature - useOfflineSync.ts still uses this until its own migration phase.
export function onConnectivityChange(listener: (state: ConnectivityState) => void): () => void {
	return useConnectivityStore.subscribe((s) => listener(s.state));
}
