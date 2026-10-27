import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPoller } from "../poller";

function setup(intervalMs = 12_000) {
	let visible = true;
	let visibilityListener: (() => void) | null = null;
	const task = vi.fn(() => Promise.resolve());
	const poller = createPoller({
		intervalMs,
		task,
		isVisible: () => visible,
		onVisibilityChange: (listener) => {
			visibilityListener = listener;
			return () => {
				visibilityListener = null;
			};
		},
	});
	const setVisible = (value: boolean) => {
		visible = value;
		visibilityListener?.();
	};
	return { poller, task, setVisible, hasListener: () => visibilityListener !== null };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("createPoller", () => {
	it("runs at once, then every interval", async () => {
		const { poller, task } = setup();
		poller.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(task).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(12_000);
		expect(task).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(24_000);
		expect(task).toHaveBeenCalledTimes(4);
		poller.stop();
	});

	it("pauses while hidden and runs immediately when shown again", async () => {
		const { poller, task, setVisible } = setup();
		poller.start();
		await vi.advanceTimersByTimeAsync(0);
		setVisible(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(task).toHaveBeenCalledTimes(1);
		setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(task).toHaveBeenCalledTimes(2);
		poller.stop();
	});

	it("refresh runs now and restarts the interval", async () => {
		const { poller, task } = setup();
		poller.start();
		await vi.advanceTimersByTimeAsync(10_000);
		await poller.refresh();
		expect(task).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(task).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(task).toHaveBeenCalledTimes(3);
		poller.stop();
	});

	it("never runs two requests at once", async () => {
		let release: () => void = () => {};
		const task = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
		const poller = createPoller({ intervalMs: 1_000, task, isVisible: () => true, onVisibilityChange: () => () => {} });
		poller.start();
		await vi.advanceTimersByTimeAsync(5_000);
		void poller.refresh();
		expect(task).toHaveBeenCalledTimes(1);
		release();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(task).toHaveBeenCalledTimes(2);
		poller.stop();
	});

	it("keeps polling after a failed request, and stops for good on stop", async () => {
		const task = vi.fn(() => Promise.reject(new Error("offline")));
		const poller = createPoller({ intervalMs: 1_000, task, isVisible: () => true, onVisibilityChange: () => () => {} });
		poller.start();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(task).toHaveBeenCalledTimes(3);
		poller.stop();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(task).toHaveBeenCalledTimes(3);
	});

	it("unsubscribes from visibility changes on stop", () => {
		const { poller, hasListener } = setup();
		poller.start();
		expect(hasListener()).toBe(true);
		poller.stop();
		expect(hasListener()).toBe(false);
	});
});
