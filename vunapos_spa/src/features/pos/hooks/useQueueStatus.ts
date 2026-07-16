import { useQueueStore } from "../../../lib/stores/queueStore";
import { useConnectivity } from "./useConnectivity";

export function useQueueStatus() {
	const connectivity = useConnectivity();
	const pending = useQueueStore((s) => s.pending);
	const parked = useQueueStore((s) => s.parked);

	return { ...connectivity, pending, parked };
}
