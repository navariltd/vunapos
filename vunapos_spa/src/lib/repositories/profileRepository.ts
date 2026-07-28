import { db } from "../db";
import type { CachedProfile } from "../types";

// Exactly one active POS Profile per device (§6.1) - the table only ever holds one row.
export const profileRepository = {
	async getActive(): Promise<CachedProfile | undefined> {
		return (await db.profile.toArray())[0];
	},
};
