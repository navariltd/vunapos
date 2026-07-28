import { useConnectivityStore } from "../../../lib/stores/connectivityStore";

// navigator.onLine is never trusted as truth - this is a thin selector over
// connectivityStore. The actual ping interval/listeners live in the single
// always-mounted <ConnectivityMonitor/>, not here, so multiple call sites
// (POSHomePage, CloseShiftPage, and bootstrap refresh) don't each register their own.
export function useConnectivity() {
	const state = useConnectivityStore((s) => s.state);

	return {
		state,
		isReachable: state === "reachable",
		isUnreachable: state === "unreachable",
	};
}
