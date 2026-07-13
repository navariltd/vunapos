import { useQueueStatus } from "../../features/pos/hooks/useQueueStatus";

// §17 P8/P10 exit gate: nothing when clean, amber while draining/backing off,
// red when a permanent failure has parked the queue and needs a supervisor.
export function SyncStatusPill() {
	const { parked, pending, state } = useQueueStatus();

	if (parked > 0) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-[11px] font-semibold text-on-error-container">
				🔴 {parked} blocked
			</span>
		);
	}

	if (pending > 0) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-semibold text-on-secondary-container">
				🟡 {pending} pending
			</span>
		);
	}

	if (state === "unreachable") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
				Offline
			</span>
		);
	}

	return null;
}
