import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { withDrainLock } from "../drainLock";

beforeEach(async () => {
	await db.meta.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

// Node 24+ implements the Web Locks API natively (navigator.locks is real), so
// exercising the meta-table CAS fallback requires explicitly hiding it, same as an
// older/locked-down terminal browser genuinely would not have it.
describe("withDrainLock (lease fallback - no Web Locks API)", () => {
	beforeEach(() => {
		vi.stubGlobal("navigator", {});
	});


	it("runs fn and returns its result when the lease is free", async () => {
		const result = await withDrainLock(async () => "done");
		expect(result).toBe("done");
	});

	it("releases the lease after fn completes, so a later call can acquire it", async () => {
		await withDrainLock(async () => "first");
		const second = await withDrainLock(async () => "second");
		expect(second).toBe("second");
	});

	it("refuses a second concurrent acquire while the first is still running (mutual exclusion)", async () => {
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = withDrainLock(async () => {
			await firstBlocked;
			return "first";
		});

		// Give the first call's transaction a tick to actually acquire the lease.
		await new Promise((resolve) => setTimeout(resolve, 10));

		const second = await withDrainLock(async () => "second");
		expect(second).toBeNull();

		releaseFirst();
		expect(await first).toBe("first");
	});

	it("releases the lease even when fn throws", async () => {
		await expect(
			withDrainLock(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const after = await withDrainLock(async () => "recovered");
		expect(after).toBe("recovered");
	});

	it("lets a new holder steal a stale lease (heartbeat older than 30s) instead of blocking forever", async () => {
		await db.meta.put({
			key: "drain_lease",
			value: { holder: "zombie-tab", heartbeat_at: Date.now() - 31_000 },
		});

		const result = await withDrainLock(async () => "stolen");
		expect(result).toBe("stolen");
	});

	it("does not let a fresh lease (heartbeat within 30s) be stolen", async () => {
		await db.meta.put({
			key: "drain_lease",
			value: { holder: "other-tab", heartbeat_at: Date.now() },
		});

		const result = await withDrainLock(async () => "should-not-run");
		expect(result).toBeNull();
	});

	it(
		"signals lease loss to fn once another tab steals it mid-run, on the next heartbeat tick",
		async () => {
			// Real timers (fake timers hang here - Dexie/fake-indexeddb schedule their
			// own internal callbacks via setTimeout, which a fake clock never fires) -
			// waits slightly past the real 5s HEARTBEAT_INTERVAL_MS for one tick.
			const observed: boolean[] = [];

			const result = await withDrainLock(async (signal) => {
				observed.push(signal.lost());
				// Simulate this tab being suspended/throttled long enough for another
				// tab to see the lease as stale and take it over.
				await db.meta.put({ key: "drain_lease", value: { holder: "other-tab", heartbeat_at: Date.now() } });
				await new Promise((resolve) => setTimeout(resolve, 5_200));
				observed.push(signal.lost());
				return "ran-to-completion";
			});

			expect(observed).toEqual([false, true]);
			// fn itself isn't forcibly cancelled (can't be, mid-await) - but it observed
			// the loss and, in a real caller like runDrainPass, would stop there.
			expect(result).toBe("ran-to-completion");
		},
		10_000,
	);
});

describe("withDrainLock (Web Locks API present)", () => {
	it("runs fn when the lock is granted", async () => {
		const request = vi.fn(async (_name: string, _opts: unknown, callback: (lock: unknown) => unknown) =>
			callback({}),
		);
		vi.stubGlobal("navigator", { locks: { request } });

		const result = await withDrainLock(async () => "granted");

		expect(result).toBe("granted");
		expect(request).toHaveBeenCalledWith("vunapos-sync-drain", { ifAvailable: true }, expect.any(Function));
	});

	it("returns null without running fn when another tab already holds the lock", async () => {
		const request = vi.fn(async (_name: string, _opts: unknown, callback: (lock: unknown) => unknown) =>
			callback(null),
		);
		vi.stubGlobal("navigator", { locks: { request } });
		const fn = vi.fn(async () => "should-not-run");

		const result = await withDrainLock(fn);

		expect(result).toBeNull();
		expect(fn).not.toHaveBeenCalled();
	});
});
