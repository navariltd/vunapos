import { useQueueStore } from "../../../lib/stores/queueStore";
import type { QueueEntry } from "../../../lib/types";

export function useQueueEntries(): QueueEntry[] {
	return useQueueStore((s) => s.entries);
}
