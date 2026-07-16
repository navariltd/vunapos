import { liveQuery } from "dexie";
import { create } from "zustand";

import { queueRepository } from "../repositories/queueRepository";
import type { QueueEntry } from "../types";

type QueueStore = {
	entries: QueueEntry[];
	pending: number;
	parked: number;
};

export function deriveQueueCounts(entries: QueueEntry[]): { pending: number; parked: number } {
	return {
		pending: entries.filter((row) => row.status === "pending" || row.status === "syncing").length,
		parked: entries.filter((row) => row.status === "error").length,
	};
}

export const useQueueStore = create<QueueStore>(() => ({ entries: [], pending: 0, parked: 0 }));

// Single module-scope subscription (via the "dexie" package's liveQuery, not
// dexie-react-hooks) so the Header pill and Queue Inspector don't each open their own
// IndexedDB subscription to the same table.
liveQuery(() => queueRepository.getAll()).subscribe({
	next: (entries) => useQueueStore.setState({ entries, ...deriveQueueCounts(entries) }),
	error: (err) => console.error("Queue live-query failed", err),
});
