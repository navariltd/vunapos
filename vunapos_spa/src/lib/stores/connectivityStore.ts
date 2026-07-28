import { create } from "zustand";

import { pingServer } from "../apiClient";

// navigator.onLine reflects NIC state, not server reachability (a killed backend still
// reports `true`). "Reachable" here means we've actually heard back from Frappe - via a
// health-check ping or another successful server request.
export type ConnectivityState = "unknown" | "checking" | "reachable" | "unreachable";

type ConnectivityStore = {
	state: ConnectivityState;
	reportReachable: () => void;
	checkReachability: () => Promise<ConnectivityState>;
};

export const useConnectivityStore = create<ConnectivityStore>((set, get) => ({
	state: "unknown",
	// A successful application request is stronger proof of reachability than a separate ping.
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
