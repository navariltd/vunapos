import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as apiClient from "../apiClient";
import { db } from "../db";
import { makeHoldEntry, makeInvoiceEntry as makeEntry } from "./fixtures/queueEntries";
import { queueRepository } from "../repositories/queueRepository";
import { drainQueue } from "../syncEngine";
import { VunaApiError } from "../../services/vunaApi";

beforeEach(async () => {
	await db.queue.clear();
	await db.mappings.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("drainQueue", () => {
	it("drains all due entries to success in FIFO order", async () => {
		await queueRepository.append(makeEntry({ local_id: "a", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "b", created_at: "2026-07-10T08:05:00Z" }));
		const postSpy = vi
			.spyOn(apiClient, "postInvoice")
			.mockImplementation(async (_payload, _key, localId) => ({
				local_id: localId,
				invoice: `ACC-SINV-${localId}`,
				status: "synced",
				duplicate: false,
			}));

		const result = await drainQueue();

		expect(result).toEqual({ processed: 2, parked: [], stoppedReason: "empty" });
		expect(postSpy.mock.calls.map((call) => call[2])).toEqual(["a", "b"]);
		const a = await queueRepository.getByLocalId("a");
		const b = await queueRepository.getByLocalId("b");
		expect(a?.status).toBe("succeeded");
		expect(b?.status).toBe("succeeded");
		expect((await db.mappings.get("a"))?.server_name).toBe("ACC-SINV-a");
	});

	it("treats a duplicate:true response as success (lost-response recovery, I2)", async () => {
		await queueRepository.append(makeEntry({ local_id: "retry-of-lost-response" }));
		vi.spyOn(apiClient, "postInvoice").mockResolvedValue({
			local_id: "retry-of-lost-response",
			invoice: "ACC-SINV-EXISTING",
			status: "synced",
			duplicate: true,
		});

		const result = await drainQueue();

		expect(result).toEqual({ processed: 1, parked: [], stoppedReason: "empty" });
		const row = await queueRepository.getByLocalId("retry-of-lost-response");
		expect(row?.status).toBe("succeeded");
		expect(row?.attempts[0].detail).toMatch(/duplicate/i);
	});

	it("schedules a backoff retry and stops the pass on a network failure, leaving later entries untouched", async () => {
		await queueRepository.append(makeEntry({ local_id: "fails", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "never-reached", created_at: "2026-07-10T08:05:00Z" }));
		vi.spyOn(apiClient, "postInvoice").mockRejectedValue(new TypeError("Failed to fetch"));

		const before = Date.now();
		const result = await drainQueue();

		expect(result.stoppedReason).toBe("retry_scheduled");
		expect(result.processed).toBe(0);
		const failed = await queueRepository.getByLocalId("fails");
		expect(failed?.status).toBe("pending");
		expect(failed?.attempts[0].outcome).toBe("network_error");
		expect(new Date(failed!.next_retry_at!).getTime()).toBeGreaterThanOrEqual(before + 60_000);

		const untouched = await queueRepository.getByLocalId("never-reached");
		expect(untouched?.status).toBe("pending");
		expect(untouched?.attempts).toHaveLength(0);
	});

	it("parks a permanently-failed entry but keeps draining the rest of the queue (invoices are independent)", async () => {
		// INV-A, INV-B, INV-C, INV-D: B fails permanently, A/C/D must still sync.
		// There is no open_shift/close_shift chaining yet (group is always null
		// today), so one bad sale must not block every unrelated sale behind it.
		await queueRepository.append(makeEntry({ local_id: "INV-A", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "INV-B", created_at: "2026-07-10T08:01:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "INV-C", created_at: "2026-07-10T08:02:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "INV-D", created_at: "2026-07-10T08:03:00Z" }));
		vi.spyOn(apiClient, "postInvoice").mockImplementation(async (_payload, _key, localId) => {
			if (localId === "INV-B") {
				throw new VunaApiError("Item not found", "ITEM_NOT_FOUND");
			}
			return { local_id: localId, invoice: `ACC-SINV-${localId}`, status: "synced", duplicate: false };
		});

		const result = await drainQueue();

		expect(result).toEqual({ processed: 3, parked: ["INV-B"], stoppedReason: "empty" });
		expect((await queueRepository.getByLocalId("INV-A"))?.status).toBe("succeeded");
		expect((await queueRepository.getByLocalId("INV-C"))?.status).toBe("succeeded");
		expect((await queueRepository.getByLocalId("INV-D"))?.status).toBe("succeeded");

		const parkedEntry = await queueRepository.getByLocalId("INV-B");
		expect(parkedEntry?.status).toBe("error");
		expect(parkedEntry?.attempts[0].outcome).toBe("rejected");
		expect(parkedEntry?.attempts[0].detail).toBe("Item not found");
	});

	it("classifies a transport-level HTTP error (5xx/proxy) as retriable, not permanent", async () => {
		await queueRepository.append(makeEntry({ local_id: "server-down" }));
		vi.spyOn(apiClient, "postInvoice").mockRejectedValue(
			new VunaApiError("create_pos_invoice failed with status 503", "HTTP_ERROR"),
		);

		const result = await drainQueue();

		expect(result.stoppedReason).toBe("retry_scheduled");
		const row = await queueRepository.getByLocalId("server-down");
		expect(row?.status).toBe("pending");
		expect(row?.attempts[0].outcome).toBe("server_error");
	});

	it("classifies a transient server-side infra error (lock timeout / concurrent-edit conflict) as retriable, not permanent", async () => {
		await queueRepository.append(makeEntry({ local_id: "INV-A", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "lock-timeout", created_at: "2026-07-10T08:01:00Z" }));
		vi.spyOn(apiClient, "postInvoice").mockImplementation(async (_payload, _key, localId) => {
			if (localId === "lock-timeout") {
				throw new VunaApiError("Deadlock found when trying to get lock", "OperationalError");
			}
			return { local_id: localId, invoice: `ACC-SINV-${localId}`, status: "synced", duplicate: false };
		});

		const result = await drainQueue();

		// A -> succeeds; lock-timeout -> retriable, so the pass stops there (transient
		// failures halt the pass, unlike permanent ones which park-and-continue).
		expect(result).toEqual({ processed: 1, parked: [], stoppedReason: "retry_scheduled" });
		const row = await queueRepository.getByLocalId("lock-timeout");
		expect(row?.status).toBe("pending");
		expect(row?.attempts[0].outcome).toBe("server_error");
	});

	it("increases backoff delay with repeated attempts, capped at 15 minutes", async () => {
		await queueRepository.append(
			makeEntry({
				local_id: "flaky",
				attempts: [
					{ at: "t1", outcome: "network_error" },
					{ at: "t2", outcome: "network_error" },
					{ at: "t3", outcome: "network_error" },
					{ at: "t4", outcome: "network_error" },
					{ at: "t5", outcome: "network_error" },
				],
			}),
		);
		vi.spyOn(apiClient, "postInvoice").mockRejectedValue(new TypeError("network down"));

		const before = Date.now();
		await drainQueue();

		const row = await queueRepository.getByLocalId("flaky");
		const delay = new Date(row!.next_retry_at!).getTime() - before;
		expect(delay).toBeGreaterThanOrEqual(900_000);
		expect(delay).toBeLessThan(910_000);
	});

	it("force:true drains an entry even before its backoff next_retry_at has elapsed", async () => {
		await queueRepository.append(
			makeEntry({
				local_id: "reconnected-early",
				next_retry_at: "2099-01-01T00:00:00Z",
			}),
		);
		vi.spyOn(apiClient, "postInvoice").mockResolvedValue({
			local_id: "reconnected-early",
			invoice: "ACC-SINV-RECONNECT",
			status: "synced",
			duplicate: false,
		});

		const notForced = await drainQueue();
		expect(notForced).toEqual({ processed: 0, parked: [], stoppedReason: "empty" });

		const forced = await drainQueue({ force: true });
		expect(forced).toEqual({ processed: 1, parked: [], stoppedReason: "empty" });
		expect((await queueRepository.getByLocalId("reconnected-early"))?.status).toBe("succeeded");
	});

	it("prunes an old succeeded entry from a prior pass, but never one that just succeeded in this pass", async () => {
		// "old" here predates syncEngine's retention window entirely (a real prior sync,
		// not just an earlier tick), so it must already be gone by the time this pass runs.
		await queueRepository.append(makeEntry({ local_id: "old", created_at: "2020-01-01T00:00:00Z" }));
		await queueRepository.markSucceeded(
			"old",
			{ at: "2020-01-01T00:00:01Z", outcome: "success" },
			"ACC-SINV-OLD",
		);
		await queueRepository.append(makeEntry({ local_id: "brand-new", created_at: "2026-07-10T08:00:00Z" }));
		vi.spyOn(apiClient, "postInvoice").mockResolvedValue({
			local_id: "brand-new",
			invoice: "ACC-SINV-NEW",
			status: "synced",
			duplicate: false,
		});

		const result = await drainQueue();

		expect(result).toEqual({ processed: 1, parked: [], stoppedReason: "empty" });
		// Pruned: succeeded long before this pass even started.
		expect(await queueRepository.getByLocalId("old")).toBeUndefined();
		expect(await db.mappings.get("old")).toBeUndefined();
		// Not pruned: this pass is exactly what just settled it - cartStore.ts's
		// race-window read (getByLocalId right after drainQueue() resolves) depends on
		// this still being readable.
		const fresh = await queueRepository.getByLocalId("brand-new");
		expect(fresh?.status).toBe("succeeded");
		expect((await db.mappings.get("brand-new"))?.server_name).toBe("ACC-SINV-NEW");
	});

	it("refuses to run a second drain concurrently (single in-process mutex)", async () => {
		await queueRepository.append(makeEntry({ local_id: "slow" }));
		let resolvePost!: (value: apiClient.CreatePosInvoiceResult) => void;
		vi.spyOn(apiClient, "postInvoice").mockReturnValue(
			new Promise((resolve) => {
				resolvePost = resolve;
			}),
		);

		const firstDrain = drainQueue();
		const secondDrain = await drainQueue();

		expect(secondDrain).toEqual({ processed: 0, parked: [], stoppedReason: "already_draining" });

		resolvePost({ local_id: "slow", invoice: "ACC-SINV-SLOW", status: "synced", duplicate: false });
		await firstDrain;
	});
});

describe("drainQueue (hold_invoice entries)", () => {
	it("dispatches a hold_invoice entry to postHold, not postInvoice", async () => {
		await queueRepository.append(makeHoldEntry({ local_id: "hold-a" }));
		const holdSpy = vi.spyOn(apiClient, "postHold").mockResolvedValue({
			local_id: "hold-a",
			invoice: "ACC-SINV-HELD-a",
			status: "held",
			duplicate: false,
		});
		const invoiceSpy = vi.spyOn(apiClient, "postInvoice");

		const result = await drainQueue();

		expect(result).toEqual({ processed: 1, parked: [], stoppedReason: "empty" });
		expect(holdSpy).toHaveBeenCalledWith(expect.anything(), "hold-idem-1", "hold-a");
		expect(invoiceSpy).not.toHaveBeenCalled();
		const row = await queueRepository.getByLocalId("hold-a");
		expect(row?.status).toBe("succeeded");
		expect((await db.mappings.get("hold-a"))?.server_name).toBe("ACC-SINV-HELD-a");
	});

	it("treats a duplicate:true hold response as success (lost-response recovery)", async () => {
		await queueRepository.append(makeHoldEntry({ local_id: "hold-retry" }));
		vi.spyOn(apiClient, "postHold").mockResolvedValue({
			local_id: "hold-retry",
			invoice: "ACC-SINV-HELD-EXISTING",
			status: "held",
			duplicate: true,
		});

		const result = await drainQueue();

		expect(result).toEqual({ processed: 1, parked: [], stoppedReason: "empty" });
		const row = await queueRepository.getByLocalId("hold-retry");
		expect(row?.status).toBe("succeeded");
		expect(row?.attempts[0].detail).toMatch(/duplicate/i);
	});

	it("schedules a backoff retry and stops the pass on a network failure", async () => {
		await queueRepository.append(makeHoldEntry({ local_id: "hold-fails" }));
		vi.spyOn(apiClient, "postHold").mockRejectedValue(new TypeError("Failed to fetch"));

		const result = await drainQueue();

		expect(result.stoppedReason).toBe("retry_scheduled");
		const row = await queueRepository.getByLocalId("hold-fails");
		expect(row?.status).toBe("pending");
		expect(row?.attempts[0].outcome).toBe("network_error");
	});

	it("parks a permanently-rejected hold but keeps draining unrelated entries (a hold and a sale queued together)", async () => {
		await queueRepository.append(makeHoldEntry({ local_id: "hold-bad", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "sale-ok", created_at: "2026-07-10T08:01:00Z" }));
		vi.spyOn(apiClient, "postHold").mockRejectedValue(new VunaApiError("Totals do not match", "TOTALS_VARIANCE"));
		vi.spyOn(apiClient, "postInvoice").mockResolvedValue({
			local_id: "sale-ok",
			invoice: "ACC-SINV-sale-ok",
			status: "synced",
			duplicate: false,
		});

		const result = await drainQueue();

		expect(result).toEqual({ processed: 1, parked: ["hold-bad"], stoppedReason: "empty" });
		expect((await queueRepository.getByLocalId("hold-bad"))?.status).toBe("error");
		expect((await queueRepository.getByLocalId("sale-ok"))?.status).toBe("succeeded");
	});
});
