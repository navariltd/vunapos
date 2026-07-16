import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { META_KEYS, metaRepository } from "../repositories/metaRepository";
import { requestPersistentStorage } from "../storagePersistence";

beforeEach(async () => {
	await db.meta.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("requestPersistentStorage", () => {
	it("records true when the browser grants persistence", async () => {
		vi.stubGlobal("navigator", { storage: { persist: vi.fn().mockResolvedValue(true) } });

		const granted = await requestPersistentStorage();

		expect(granted).toBe(true);
		expect(await metaRepository.get(META_KEYS.storagePersisted)).toBe(true);
	});

	it("records false when the browser denies persistence", async () => {
		vi.stubGlobal("navigator", { storage: { persist: vi.fn().mockResolvedValue(false) } });

		const granted = await requestPersistentStorage();

		expect(granted).toBe(false);
		expect(await metaRepository.get(META_KEYS.storagePersisted)).toBe(false);
	});

	it("degrades gracefully (records false, doesn't throw) when the API is unavailable", async () => {
		vi.stubGlobal("navigator", {});

		const granted = await requestPersistentStorage();

		expect(granted).toBe(false);
		expect(await metaRepository.get(META_KEYS.storagePersisted)).toBe(false);
	});

	it("degrades gracefully when persist() itself rejects", async () => {
		vi.stubGlobal("navigator", { storage: { persist: vi.fn().mockRejectedValue(new Error("denied")) } });

		const granted = await requestPersistentStorage();

		expect(granted).toBe(false);
	});
});
