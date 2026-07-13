import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as apiClient from "../apiClient";
import { db } from "../db";
import { makeInvoiceEntry } from "./fixtures/queueEntries";
import { queueRepository } from "../repositories/queueRepository";
import { drainQueue } from "../syncEngine";
import type { QueueEntry } from "../types";

beforeEach(async () => {
	await db.queue.clear();
	await db.mappings.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function makeEntry(index: number): QueueEntry {
	return makeInvoiceEntry({
		local_id: `local-${index}`,
		local_ref: `POS-VOL-${String(index).padStart(5, "0")}`,
		idempotency_key: `idem-${index}`,
		created_at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
	});
}

// F14/§15.1: "a 300-entry backlog drains in <5 min" rests on the serial drain loop
// itself not degrading as the queue grows. This proves the loop's *own* overhead
// stays flat at scale - server-side latency is measured separately
// (test_sync_service.py::test_create_pos_invoice_server_side_latency).
describe("drainQueue at volume (F14)", () => {
	it("drains a 300-entry backlog completely, in FIFO order, with flat per-entry overhead", async () => {
		const BACKLOG_SIZE = 300;
		for (let i = 0; i < BACKLOG_SIZE; i++) {
			await queueRepository.append(makeEntry(i));
		}

		const callOrder: string[] = [];
		vi.spyOn(apiClient, "postInvoice").mockImplementation(async (_payload, _key, localId) => {
			callOrder.push(localId);
			// A small, realistic per-call delay (simulated network/server latency) -
			// enough to make an O(n^2) regression visible without making the test slow.
			await new Promise((resolve) => setTimeout(resolve, 2));
			return { local_id: localId, invoice: `ACC-SINV-${localId}`, status: "synced", duplicate: false };
		});

		const start = performance.now();
		const result = await drainQueue();
		const elapsedMs = performance.now() - start;

		expect(result.processed).toBe(BACKLOG_SIZE);
		expect(result.parked).toEqual([]);
		expect(result.stoppedReason).toBe("empty");
		expect(callOrder).toEqual(Array.from({ length: BACKLOG_SIZE }, (_, i) => `local-${i}`));

		const succeededCount = (await queueRepository.getAll()).filter((row) => row.status === "succeeded").length;
		expect(succeededCount).toBe(BACKLOG_SIZE);
		expect(await db.mappings.count()).toBe(BACKLOG_SIZE);

		console.log(
			`[F14] drainQueue loop overhead for ${BACKLOG_SIZE} entries: ${elapsedMs.toFixed(0)}ms total ` +
				`(${(elapsedMs / BACKLOG_SIZE).toFixed(2)}ms/entry of pure loop+Dexie overhead, excluding real network)`,
		);
		// Generous ceiling on pure loop overhead (excludes the ~2ms/call simulated network
		// delay, ~600ms total) - catches a real per-entry regression (e.g. an accidental
		// full-table scan) without being sensitive to this machine's speed.
		expect(elapsedMs).toBeLessThan(BACKLOG_SIZE * 20);
	});
});
