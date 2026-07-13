import { postHold, postInvoice } from "./apiClient";
import { withDrainLock, type LeaseSignal } from "./drainLock";
import { queueRepository } from "./repositories/queueRepository";
import { reportReachable } from "./stores/connectivityStore";
import { VunaApiError } from "../services/vunaApi";
import type { QueueAttempt } from "./types";

// §11.4 failure classification, §8.2 backoff schedule (1m -> 2m -> 5m -> 15m cap).
// Never imports a React-bound Zustand hook (§4.4): this module runs outside any
// component's lifecycle (timer, reconnect, click handler). Calling a store's vanilla
// getState()/setState() (as reportReachable does) is fine - no component needed.
const BACKOFF_SCHEDULE_MS = [60_000, 120_000, 300_000, 900_000];

export function nextRetryDelayMs(priorAttemptCount: number): number {
	const index = Math.min(priorAttemptCount, BACKOFF_SCHEDULE_MS.length - 1);
	return BACKOFF_SCHEDULE_MS[index];
}

type FailureClass = "retriable" | "permanent";

type Classification = {
	failureClass: FailureClass;
	outcome: QueueAttempt["outcome"];
	detail: string;
};

// Closed set of exception class names for genuinely transient server-side
// infrastructure conditions (DB lock-wait timeout/deadlock, concurrent-edit conflict
// mid-save) rather than business-rule rejections. _failure_from_exception
// (vunapos/api/pos.py) stamps any exception lacking an explicit vuna_error_code with
// its Python class name, so these arrive here exactly as named.
const TRANSIENT_SERVER_ERROR_CODES = new Set(["TimestampMismatchError", "OperationalError"]);

// "HTTP_ERROR" means the request never reached application logic (5xx, proxy
// failure, non-2xx transport) - retriable, as is any TRANSIENT_SERVER_ERROR_CODES
// code. Any other VunaApiError means the server structurally rejected the request (a
// 200 {ok:false} envelope) - permanent, including a bare frappe.throw() with no
// custom code (e.g. insufficient stock) arriving as code="ValidationError". Anything
// else (fetch throwing, JSON parsing failing) is a raw network failure.
export function classifyFailure(err: unknown): Classification {
	if (err instanceof VunaApiError) {
		if (err.code === "HTTP_ERROR" || (err.code && TRANSIENT_SERVER_ERROR_CODES.has(err.code))) {
			return { failureClass: "retriable", outcome: "server_error", detail: err.message };
		}
		if (err.code === "TOTALS_VARIANCE") {
			return { failureClass: "permanent", outcome: "totals_variance", detail: err.message };
		}
		return { failureClass: "permanent", outcome: "rejected", detail: err.message };
	}
	return {
		failureClass: "retriable",
		outcome: "network_error",
		detail: err instanceof Error ? err.message : String(err),
	};
}

export type DrainResult = {
	processed: number;
	/** local_ids parked (permanent failure) this pass - an exception list, not a
	 * blocker: every queued invoice is independent (no shift-chaining yet; `group`
	 * is reserved for that, always null today) and draining continues regardless. */
	parked: string[];
	stoppedReason: "empty" | "retry_scheduled" | "already_draining";
};

/**
 * One entry in flight, oldest-first, exclusive across every tab (drainLock.ts) and
 * within this tab. A permanent failure parks that entry and moves on - invoices are
 * independent, so one bad sale must not block unrelated ones behind it. A transient
 * (network) failure stops the whole pass instead: if this attempt couldn't reach the
 * server, the next hundred won't either, so there's no point burning through the
 * rest of the queue before backing off.
 */
export async function drainQueue(options: { force?: boolean } = {}): Promise<DrainResult> {
	// withDrainLock returns null on contention - the Web Locks {ifAvailable:true} path
	// and the CAS lease fallback both also refuse a same-tab re-entrant call (a fresh
	// holderId per call means a second concurrent call from this tab sees the
	// lock/lease as already taken), so a separate isDraining flag would be redundant.
	const result = await withDrainLock((signal) => runDrainPass(options, signal));
	return result ?? { processed: 0, parked: [], stoppedReason: "already_draining" };
}

async function runDrainPass(options: { force?: boolean }, signal: LeaseSignal): Promise<DrainResult> {
	await queueRepository.reclaimStaleSyncing();
	let processed = 0;
	const parked: string[] = [];
	for (;;) {
		if (signal.lost()) {
			// Another tab took over the lease (this one was suspended/throttled past
			// LEASE_STALE_AFTER_MS) - stop pulling more entries. An in-flight request
			// can't be cancelled, but the server-side idempotency key is the backstop
			// for that (§8.4/F6).
			return { processed, parked, stoppedReason: "empty" };
		}
		const due = options.force
			? await queueRepository.getAllPending()
			: await queueRepository.getPendingDue(new Date().toISOString());
		const next = due[0];
		if (!next) {
			return { processed, parked, stoppedReason: "empty" };
		}

		await queueRepository.markSyncing(next.local_id);
		try {
			const result =
				next.type === "hold_invoice"
					? await postHold(next.payload, next.idempotency_key, next.local_id)
					: await postInvoice(next.payload, next.idempotency_key, next.local_id);
			// A successful upload is itself proof of reachability - cheaper than a
			// redundant ping, and it's the signal that matters (§8.3).
			reportReachable();
			await queueRepository.markSucceeded(
				next.local_id,
				{
					at: new Date().toISOString(),
					outcome: "success",
					detail: result.duplicate ? "server reported duplicate (lost-response recovery)" : undefined,
				},
				result.invoice,
			);
			processed += 1;
			continue;
		} catch (err) {
			const { failureClass, outcome, detail } = classifyFailure(err);
			const attempt: QueueAttempt = { at: new Date().toISOString(), outcome, detail };

			if (failureClass === "permanent") {
				await queueRepository.markError(next.local_id, attempt);
				parked.push(next.local_id);
				continue;
			}

			const delayMs = nextRetryDelayMs(next.attempts.length);
			const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
			await queueRepository.scheduleRetry(next.local_id, attempt, nextRetryAt);
			return { processed, parked, stoppedReason: "retry_scheduled" };
		}
	}
}
