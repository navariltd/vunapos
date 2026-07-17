import { db } from "./db";

// Ensures exactly one drain across every tab/window this terminal has open (F6: a
// shared till with two tabs open is a real risk). Prefers the Web Locks API - it
// auto-releases on tab crash/kill; falls back to a CAS lease in `meta` for browsers
// that lack it.

const LOCK_NAME = "vunapos-sync-drain";
const LEASE_KEY = "drain_lease";
const HEARTBEAT_INTERVAL_MS = 5_000;
const LEASE_STALE_AFTER_MS = 30_000;

type Lease = { holder: string; heartbeat_at: number };

function hasWebLocks(): boolean {
	return typeof navigator !== "undefined" && "locks" in navigator && Boolean(navigator.locks);
}

// Must run as one atomic Dexie 'rw' transaction: IndexedDB serializes readwrite
// transactions per store, so two tabs can never both read "stale" and write "mine"
// in the same instant. Splitting into separate read/write calls reintroduces that race.
async function tryAcquireLease(holderId: string): Promise<boolean> {
	return db.transaction("rw", db.meta, async () => {
		const row = await db.meta.get(LEASE_KEY);
		const lease = row?.value as Lease | undefined;
		const now = Date.now();
		if (lease && lease.holder !== holderId && now - lease.heartbeat_at < LEASE_STALE_AFTER_MS) {
			return false;
		}
		await db.meta.put({ key: LEASE_KEY, value: { holder: holderId, heartbeat_at: now } satisfies Lease });
		return true;
	});
}

// Fencing: re-verifies ownership before renewing, so a tab suspended past staleness
// notices its lease was stolen and stops (idempotency key I2 is the backstop if a
// zombie tab uploads anyway).
async function heartbeatLease(holderId: string): Promise<boolean> {
	return db.transaction("rw", db.meta, async () => {
		const row = await db.meta.get(LEASE_KEY);
		const lease = row?.value as Lease | undefined;
		if (!lease || lease.holder !== holderId) {
			return false;
		}
		await db.meta.put({ key: LEASE_KEY, value: { holder: holderId, heartbeat_at: Date.now() } satisfies Lease });
		return true;
	});
}

async function releaseLease(holderId: string): Promise<void> {
	await db.transaction("rw", db.meta, async () => {
		const row = await db.meta.get(LEASE_KEY);
		const lease = row?.value as Lease | undefined;
		if (lease?.holder === holderId) {
			await db.meta.delete(LEASE_KEY);
		}
	});
}

/** Passed to `fn` so a long-running drain can notice mid-flight that this tab's
 * lease was stolen (heartbeat missed the 30s staleness window) and stop pulling
 * more queue entries, rather than a lost lease being detected but silently ignored. */
export type LeaseSignal = { lost(): boolean };

async function withLeaseFallback<T>(fn: (signal: LeaseSignal) => Promise<T>): Promise<T | null> {
	const holderId = crypto.randomUUID();
	const acquired = await tryAcquireLease(holderId);
	if (!acquired) {
		return null;
	}
	let leaseLost = false;
	const signal: LeaseSignal = { lost: () => leaseLost };
	const heartbeat = setInterval(() => {
		void heartbeatLease(holderId).then((stillOwned) => {
			leaseLost = leaseLost || !stillOwned;
		});
	}, HEARTBEAT_INTERVAL_MS);
	try {
		return await fn(signal);
	} finally {
		clearInterval(heartbeat);
		if (!leaseLost) {
			await releaseLease(holderId);
		}
	}
}

/**
 * Runs `fn` under an exclusive cross-tab lock; returns `null` without running `fn`
 * if another tab already holds it (treat as "nothing to do", not an error). In the
 * lease-fallback path, `fn` receives a `LeaseSignal` to poll so a stolen lease stops
 * this tab mid-drain (§8.4/F6).
 */
export async function withDrainLock<T>(fn: (signal: LeaseSignal) => Promise<T>): Promise<T | null> {
	if (hasWebLocks()) {
		return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
			if (!lock) {
				return null;
			}
			return fn({ lost: () => false });
		});
	}
	return withLeaseFallback(fn);
}
