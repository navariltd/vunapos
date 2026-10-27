import { useCallback, useEffect, useRef, useState } from "react";

import { VunaApiError } from "../../../services/vunaApi";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { createPoller, type Poller } from "../poller";

export const ORDER_POLL_INTERVAL_MS = 12_000;

// Loads `fetcher` now, then every 12 s while mounted and the tab is visible, and
// at once whenever an order action finishes (ordersRevision). The last good data
// stays on screen while a refresh is in flight or fails.
export function usePolledData<T>(key: string | null, fetcher: () => Promise<T>) {
	const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
	const fetcherRef = useRef(fetcher);
	const pollerRef = useRef<Poller | null>(null);
	const ordersRevision = useOrderDraftStore((s) => s.ordersRevision);

	useEffect(() => {
		fetcherRef.current = fetcher;
	}, [fetcher]);

	useEffect(() => {
		if (!key) return undefined;
		let active = true;
		const poller = createPoller({
			intervalMs: ORDER_POLL_INTERVAL_MS,
			task: () =>
				fetcherRef.current().then(
					(data) => {
						if (active) setState({ key, data, error: null });
					},
					(error: unknown) => {
						if (!active) return;
						const message =
							error instanceof VunaApiError || error instanceof Error ? error.message : "Could not refresh.";
						setState((current) => ({ key, data: current?.key === key ? current.data : null, error: message }));
					},
				),
		});
		pollerRef.current = poller;
		poller.start();
		return () => {
			active = false;
			poller.stop();
			pollerRef.current = null;
		};
	}, [key]);

	useEffect(() => {
		if (ordersRevision) void pollerRef.current?.refresh();
	}, [ordersRevision]);

	const refresh = useCallback(() => pollerRef.current?.refresh() ?? Promise.resolve(), []);
	const current = state?.key === key ? state : null;

	return {
		data: current?.data ?? null,
		error: current?.error ?? null,
		isLoading: Boolean(key) && !current,
		refresh,
	};
}
