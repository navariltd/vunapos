import { db } from "../db";
import type { CachedTaxTemplate } from "../types";

export const taxTemplateRepository = {
	async getAll(): Promise<CachedTaxTemplate[]> {
		return db.taxTemplates.toArray();
	},

	async getByName(name: string): Promise<CachedTaxTemplate | undefined> {
		return db.taxTemplates.get(name);
	},
};
