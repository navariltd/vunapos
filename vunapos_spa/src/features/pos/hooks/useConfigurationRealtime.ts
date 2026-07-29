import { useCallback, useEffect, useRef } from "react";
import { useFrappeEventListener } from "frappe-react-sdk";

export const CONFIGURATION_EVENT = "vunapos_configuration_changed";

export type ConfigurationChangeEvent = {
	doctype?: string;
	action?: string;
	refresh?: "full";
};

export function useConfigurationRealtime(
	onRefresh: (event: ConfigurationChangeEvent) => Promise<void>,
) {
	const refreshRef = useRef(onRefresh);
	const timerRef = useRef<number | null>(null);
	const latestEventRef = useRef<ConfigurationChangeEvent>({});
	const runningRef = useRef(false);
	const queuedRef = useRef(false);

	useEffect(() => {
		refreshRef.current = onRefresh;
	}, [onRefresh]);

	const handleEvent = useCallback((event: ConfigurationChangeEvent) => {
		latestEventRef.current = event || {};
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null;
			if (runningRef.current) {
				queuedRef.current = true;
				return;
			}
			void (async () => {
				do {
					queuedRef.current = false;
					runningRef.current = true;
					try {
						await refreshRef.current(latestEventRef.current);
					} finally {
						runningRef.current = false;
					}
				} while (queuedRef.current);
			})();
		}, 350);
	}, []);

	useFrappeEventListener<ConfigurationChangeEvent>(CONFIGURATION_EVENT, handleEvent);

	useEffect(() => () => {
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
	}, []);
}
