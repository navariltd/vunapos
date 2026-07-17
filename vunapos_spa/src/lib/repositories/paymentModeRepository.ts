import { db } from "../db";
import type { CachedPaymentMode } from "../types";

export const paymentModeRepository = {
	async getAll(): Promise<CachedPaymentMode[]> {
		return db.paymentModes.toArray();
	},
};
