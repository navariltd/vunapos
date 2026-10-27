// Runs `task` every `intervalMs` while the page is visible, never two at once.
// The table status and open orders lists use it (no realtime events yet).
export type Poller = {
	start: () => void;
	stop: () => void;
	// Run now (e.g. right after an order action), then keep the normal rhythm.
	refresh: () => Promise<void>;
};

type PollerOptions = {
	intervalMs: number;
	task: () => Promise<unknown>;
	isVisible?: () => boolean;
	// Returns an unsubscribe function. Defaults to document.visibilitychange.
	onVisibilityChange?: (listener: () => void) => () => void;
};

const documentVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

const documentVisibilityChange = (listener: () => void) => {
	if (typeof document === "undefined") return () => {};
	document.addEventListener("visibilitychange", listener);
	return () => document.removeEventListener("visibilitychange", listener);
};

export function createPoller({
	intervalMs,
	task,
	isVisible = documentVisible,
	onVisibilityChange = documentVisibilityChange,
}: PollerOptions): Poller {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running = false;
	let inFlight: Promise<void> | null = null;
	let unsubscribe: (() => void) | null = null;

	const clear = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	const schedule = () => {
		clear();
		if (running && isVisible()) timer = setTimeout(() => void run(), intervalMs);
	};

	const run = (): Promise<void> => {
		if (inFlight) return inFlight;
		clear();
		inFlight = Promise.resolve()
			.then(task)
			.then(
				() => undefined,
				() => undefined, // Errors are the task's to report; polling carries on.
			)
			.finally(() => {
				inFlight = null;
				schedule();
			});
		return inFlight;
	};

	return {
		start() {
			if (running) return;
			running = true;
			unsubscribe = onVisibilityChange(() => {
				if (!running) return;
				if (isVisible()) void run();
				else clear();
			});
			if (isVisible()) void run();
		},
		stop() {
			running = false;
			clear();
			unsubscribe?.();
			unsubscribe = null;
		},
		refresh() {
			return run();
		},
	};
}
