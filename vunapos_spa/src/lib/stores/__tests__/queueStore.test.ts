import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { makeInvoiceEntry as makeEntry } from "../../__tests__/fixtures/queueEntries";
import { queueRepository } from "../../repositories/queueRepository";
import type { QueueAttempt } from "../../types";
import { deriveQueueCounts, useQueueStore } from "../queueStore";

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

beforeEach(async () => {
	await db.queue.clear();
	await waitFor(() => useQueueStore.getState().entries.length === 0);
});

describe("deriveQueueCounts (pure)", () => {
	it("counts pending and syncing rows as pending", () => {
		const counts = deriveQueueCounts([
			makeEntry({ local_id: "a", status: "pending" }),
			makeEntry({ local_id: "b", status: "syncing" }),
		]);

		expect(counts).toEqual({ pending: 2, parked: 0 });
	});

	it("counts error rows as parked", () => {
		const counts = deriveQueueCounts([makeEntry({ local_id: "a", status: "error" })]);

		expect(counts).toEqual({ pending: 0, parked: 1 });
	});

	it("does not count succeeded rows in either bucket", () => {
		const counts = deriveQueueCounts([makeEntry({ local_id: "a", status: "succeeded" })]);

		expect(counts).toEqual({ pending: 0, parked: 0 });
	});
});

describe("queueStore (live mirror of the queue table)", () => {
	it("reflects an appended entry without any component mounted", async () => {
		await queueRepository.append(makeEntry({ local_id: "live-1" }));

		await waitFor(() => useQueueStore.getState().entries.some((e) => e.local_id === "live-1"));

		expect(useQueueStore.getState().pending).toBe(1);
		expect(useQueueStore.getState().parked).toBe(0);
	});

	it("reflects a parked (error) entry", async () => {
		await queueRepository.append(makeEntry({ local_id: "live-2" }));
		await waitFor(() => useQueueStore.getState().entries.some((e) => e.local_id === "live-2"));

		const attempt: QueueAttempt = { at: "2026-07-10T08:05:00Z", outcome: "rejected", detail: "boom" };
		await queueRepository.markError("live-2", attempt);

		await waitFor(() => useQueueStore.getState().parked === 1);

		expect(useQueueStore.getState().pending).toBe(0);
		expect(useQueueStore.getState().entries.find((e) => e.local_id === "live-2")?.status).toBe("error");
	});
});
