import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { getFreshnessStatus } from "../freshness";
import { META_KEYS, metaRepository } from "../repositories/metaRepository";

beforeEach(async () => {
	await db.meta.clear();
});

describe("getFreshnessStatus", () => {
	it("is empty when nothing has ever synced", async () => {
		expect(await getFreshnessStatus()).toBe("empty");
	});

	it("is fresh within the TTL window", async () => {
		await metaRepository.set(META_KEYS.lastDeltaSync, new Date().toISOString());

		expect(await getFreshnessStatus(5 * 60 * 60 * 1000)).toBe("fresh");
	});

	it("is stale once the TTL has elapsed, but this never gates selling on its own", async () => {
		const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
		await metaRepository.set(META_KEYS.lastDeltaSync, sixHoursAgo);

		expect(await getFreshnessStatus(5 * 60 * 60 * 1000)).toBe("stale");
	});
});
