import { db } from "../db";

export const META_KEYS = {
	lastFullSync: "last_full_sync",
	lastDeltaSync: "last_delta_sync",
	bootstrapVersion: "bootstrap_version",
	deviceId: "device_id",
	localCounter: "local_counter",
	taxSettings: "tax_settings",
	storagePersisted: "storage_persisted",
} as const;

export const metaRepository = {
	async get<T = unknown>(key: string): Promise<T | undefined> {
		const row = await db.meta.get(key);
		return row?.value as T | undefined;
	},

	async set(key: string, value: unknown): Promise<void> {
		await db.meta.put({ key, value });
	},
};
