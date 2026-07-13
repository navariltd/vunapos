import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { queueRepository } from "../repositories/queueRepository";
import { makeInvoiceEntry as makeEntry } from "./fixtures/queueEntries";

beforeEach(async () => {
	await db.queue.clear();
	await db.mappings.clear();
});

describe("queueRepository", () => {
	it("returns pending entries oldest-first, honoring next_retry_at", async () => {
		await queueRepository.append(makeEntry({ local_id: "b", created_at: "2026-07-10T08:05:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "a", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(
			makeEntry({
				local_id: "not-due-yet",
				created_at: "2026-07-10T07:00:00Z",
				next_retry_at: "2099-01-01T00:00:00Z",
			}),
		);

		const due = await queueRepository.getPendingDue("2026-07-10T09:00:00Z");

		expect(due.map((row) => row.local_id)).toEqual(["a", "b"]);
	});

	it("markSucceeded writes the local_id -> server_name mapping atomically", async () => {
		await queueRepository.append(makeEntry({ local_id: "local-x" }));

		await queueRepository.markSucceeded(
			"local-x",
			{ at: "2026-07-10T08:01:00Z", outcome: "success" },
			"ACC-SINV-2026-00099",
		);

		const row = await queueRepository.getByLocalId("local-x");
		expect(row?.status).toBe("succeeded");
		expect(row?.attempts).toHaveLength(1);
		const mapping = await db.mappings.get("local-x");
		expect(mapping?.server_name).toBe("ACC-SINV-2026-00099");
	});

	it("scheduleRetry keeps the entry pending and appends the attempt", async () => {
		await queueRepository.append(makeEntry({ local_id: "local-y" }));

		await queueRepository.scheduleRetry(
			"local-y",
			{ at: "2026-07-10T08:01:00Z", outcome: "network_error", detail: "offline" },
			"2026-07-10T08:02:00Z",
		);

		const row = await queueRepository.getByLocalId("local-y");
		expect(row?.status).toBe("pending");
		expect(row?.next_retry_at).toBe("2026-07-10T08:02:00Z");
		expect(row?.attempts).toEqual([
			{ at: "2026-07-10T08:01:00Z", outcome: "network_error", detail: "offline" },
		]);
	});

	it("markError parks the entry", async () => {
		await queueRepository.append(makeEntry({ local_id: "local-z" }));

		await queueRepository.markError("local-z", {
			at: "2026-07-10T08:01:00Z",
			outcome: "totals_variance",
			detail: "grand_total mismatch",
		});

		const row = await queueRepository.getByLocalId("local-z");
		expect(row?.status).toBe("error");
		expect(row?.next_retry_at).toBeNull();
	});

	it("getAllPending ignores next_retry_at, unlike getPendingDue", async () => {
		await queueRepository.append(
			makeEntry({
				local_id: "not-due-yet",
				created_at: "2026-07-10T07:00:00Z",
				next_retry_at: "2099-01-01T00:00:00Z",
			}),
		);

		const due = await queueRepository.getPendingDue("2026-07-10T09:00:00Z");
		const allPending = await queueRepository.getAllPending();

		expect(due).toHaveLength(0);
		expect(allPending.map((row) => row.local_id)).toEqual(["not-due-yet"]);
	});

	it("summary counts pending/error and finds the oldest pending entry", async () => {
		await queueRepository.append(makeEntry({ local_id: "p1", created_at: "2026-07-10T08:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "p2", created_at: "2026-07-10T07:00:00Z" }));
		await queueRepository.append(makeEntry({ local_id: "e1", status: "error" }));

		const summary = await queueRepository.summary();

		expect(summary.pending).toBe(2);
		expect(summary.error).toBe(1);
		expect(summary.oldestPendingCreatedAt).toBe("2026-07-10T07:00:00Z");
	});

	it("remove deletes the entry outright (used to cancel a local-only hold)", async () => {
		await queueRepository.append(makeEntry({ local_id: "gone" }));

		await queueRepository.remove("gone");

		expect(await queueRepository.getByLocalId("gone")).toBeUndefined();
	});

	it("remove is a safe no-op for a local_id that doesn't exist", async () => {
		await expect(queueRepository.remove("never-existed")).resolves.toBeUndefined();
	});
});
