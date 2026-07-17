import { db } from "../db";
import type { QueueAttempt, QueueEntry } from "../types";

// Thin repository (spec §2 principle 7): write to the queue, transition lifecycle
// fields, read it back. No business logic - the Sync Engine owns what the
// transitions *mean*, this just makes them durable.
export const queueRepository = {
	async append(entry: QueueEntry): Promise<void> {
		await db.queue.add(entry);
	},

	async getAll(): Promise<QueueEntry[]> {
		return db.queue.orderBy("created_at").toArray();
	},

	async getByLocalId(localId: string): Promise<QueueEntry | undefined> {
		return db.queue.get(localId);
	},

	async getMapping(localId: string): Promise<string | undefined> {
		const row = await db.mappings.get(localId);
		return row?.server_name;
	},

	/** Oldest-first pending entries whose next_retry_at has elapsed, honoring group order. */
	async getPendingDue(nowIso: string): Promise<QueueEntry[]> {
		const rows = await db.queue.where("status").equals("pending").sortBy("created_at");
		return rows.filter((row) => !row.next_retry_at || row.next_retry_at <= nowIso);
	},

	/** All pending entries, oldest-first, ignoring next_retry_at (§8.4: reachability
	 * regained is positive evidence overriding a backoff schedule computed while we
	 * didn't know that yet - no reason to wait out the rest of it). */
	async getAllPending(): Promise<QueueEntry[]> {
		return db.queue.where("status").equals("pending").sortBy("created_at");
	},

	async markSyncing(localId: string): Promise<void> {
		await db.queue.update(localId, { status: "syncing", next_retry_at: null });
	},

	/** Reclaims entries left "syncing" by a tab that closed/crashed mid-request. Safe at
	 * the start of a drain pass: the drain lock guarantees only one pass runs at a time,
	 * so any row still "syncing" when a pass begins is a leftover, not in flight. */
	async reclaimStaleSyncing(): Promise<void> {
		const stuck = await db.queue.where("status").equals("syncing").toArray();
		await Promise.all(stuck.map((row) => db.queue.update(row.local_id, { status: "pending" })));
	},

	async markSucceeded(localId: string, attempt: QueueAttempt, serverName: string): Promise<void> {
		await db.transaction("rw", [db.queue, db.mappings], async () => {
			const row = await db.queue.get(localId);
			if (!row) {
				return;
			}
			await db.queue.update(localId, { status: "succeeded", attempts: [...row.attempts, attempt] });
			await db.mappings.put({ local_id: localId, server_name: serverName });
		});
	},

	/** Transient failure: stays pending, backs off, auto-resumes (§11.4). */
	async scheduleRetry(localId: string, attempt: QueueAttempt, nextRetryAtIso: string): Promise<void> {
		const row = await db.queue.get(localId);
		if (!row) {
			return;
		}
		await db.queue.update(localId, {
			status: "pending",
			next_retry_at: nextRetryAtIso,
			attempts: [...row.attempts, attempt],
		});
	},

	/** Permanent failure: parks the entry and (by construction of the drain loop) its group. */
	async markError(localId: string, attempt: QueueAttempt): Promise<void> {
		const row = await db.queue.get(localId);
		if (!row) {
			return;
		}
		await db.queue.update(localId, {
			status: "error",
			next_retry_at: null,
			attempts: [...row.attempts, attempt],
		});
	},

	async retry(localId: string): Promise<void> {
		await db.queue.update(localId, { status: "pending", next_retry_at: null });
	},

	/** Deletes outright, not a status transition - used to cancel a not-yet-synced
	 * local hold on restore (cancel-and-recreate: never mutate a queued entry in place). */
	async remove(localId: string): Promise<void> {
		await db.queue.delete(localId);
	},

	/** Deletes succeeded entries (and their local_id -> server_name mapping) whose
	 * success is older than cutoffIso - keeps the queue holding only what's actually
	 * unsynced. Never touches an entry that succeeded during the current drain pass:
	 * cartStore.ts reads a just-created entry back via getByLocalId right after racing
	 * drainQueue() against a short timeout, so this must only ever prune entries that
	 * were already "succeeded" going into this pass, not ones this pass just settled. */
	async pruneSucceededBefore(cutoffIso: string): Promise<void> {
		const rows = await db.queue.where("status").equals("succeeded").toArray();
		const stale = rows.filter((row) => (row.attempts.at(-1)?.at ?? row.created_at) <= cutoffIso);
		if (!stale.length) {
			return;
		}
		await db.transaction("rw", [db.queue, db.mappings], async () => {
			await Promise.all(
				stale.map(async (row) => {
					await db.queue.delete(row.local_id);
					await db.mappings.delete(row.local_id);
				}),
			);
		});
	},

	async summary(): Promise<{ pending: number; error: number; oldestPendingCreatedAt: string | null }> {
		const rows = await db.queue.toArray();
		const pending = rows.filter((row) => row.status === "pending" || row.status === "syncing");
		const errorRows = rows.filter((row) => row.status === "error");
		const oldestPendingCreatedAt = pending.reduce<string | null>(
			(min, row) => (min === null || row.created_at < min ? row.created_at : min),
			null,
		);
		return { pending: pending.length, error: errorRows.length, oldestPendingCreatedAt };
	},
};
