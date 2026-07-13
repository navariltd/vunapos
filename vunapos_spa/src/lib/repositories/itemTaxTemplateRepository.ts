import { db } from "../db";
import type { CachedItemTaxTemplate } from "../types";

export const itemTaxTemplateRepository = {
	async getAll(): Promise<CachedItemTaxTemplate[]> {
		return db.itemTaxTemplates.toArray();
	},

	async getByName(name: string): Promise<CachedItemTaxTemplate | undefined> {
		return db.itemTaxTemplates.get(name);
	},
};
