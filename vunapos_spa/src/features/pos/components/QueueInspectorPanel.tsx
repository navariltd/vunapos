import { useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { queueRepository } from "../../../lib/repositories/queueRepository";
import { drainQueue } from "../../../lib/syncEngine";
import { useQueueEntries } from "../hooks/useQueueEntries";
import { formatCurrency } from "../utils";

function formatCreatedAt(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleString(undefined, { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" });
}

// a Queue Inspector is an exception list, not a blocked syncEngine parked entries are
// the ones that need a reviews so everything else
// in the queue keeps draining on its own regardless of what's shown here.
export function QueueInspectorPanel() {
	const entries = useQueueEntries();
	const [retryingId, setRetryingId] = useState<string | null>(null);

	const parked = entries.filter((entry) => entry.status === "error");
	const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "syncing");

	if (!parked.length && !pending.length) {
		return null;
	}

	const handleRetry = async (localId: string) => {
		setRetryingId(localId);
		try {
			await queueRepository.retry(localId);
			await drainQueue();
		} finally {
			setRetryingId(null);
		}
	};

	return (
		<div className="mt-3 rounded-md border border-outline-variant bg-surface-container-low p-3">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-semibold text-on-surface">Sync Queue</p>
					<p className="text-xs text-on-surface-variant">
						{pending.length ? `${pending.length} syncing/pending` : "Nothing pending"}
						{parked.length ? ` · ${parked.length} need attention` : ""}
					</p>
				</div>
			</div>

			{parked.length ? (
				<div className="mt-3 space-y-2">
					{parked.map((entry) => {
						const lastAttempt = entry.attempts.at(-1);
						const total = entry.payload.totals?.rounded_total ?? entry.payload.totals?.grand_total;
						return (
							<div
								key={entry.local_id}
								className="rounded-md border border-error bg-error-container p-3 text-on-error-container"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<div className="flex items-center gap-1.5">
											<AlertTriangle className="size-3.5 shrink-0" />
											<p className="truncate text-sm font-semibold">{entry.local_ref}</p>
										</div>
										<p className="mt-1 text-xs opacity-90">{lastAttempt?.detail || "Sync failed"}</p>
										<p className="mt-1 text-xs opacity-75">
											{formatCreatedAt(entry.created_at)} · {entry.attempts.length} attempt
											{entry.attempts.length === 1 ? "" : "s"}
										</p>
									</div>
									<div className="shrink-0 text-right">
										{total !== undefined ? (
											<p className="text-sm font-semibold">{formatCurrency(total)}</p>
										) : null}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="mt-1 h-8 gap-1 px-2 text-on-error-container hover:bg-error/10"
											disabled={retryingId === entry.local_id}
											onClick={() => handleRetry(entry.local_id)}
										>
											<RotateCw className={`size-3.5 ${retryingId === entry.local_id ? "animate-spin" : ""}`} />
											Retry
										</Button>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
