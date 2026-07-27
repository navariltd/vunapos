import { assembleInvoice, type AssembledInvoice, type CartLine, type ItemTaxRow } from "./invoiceEngine";
import { itemRepository } from "./repositories/itemRepository";
import { itemTaxTemplateRepository } from "./repositories/itemTaxTemplateRepository";
import { taxTemplateRepository } from "./repositories/taxTemplateRepository";
import { resolveTaxSettings } from "./taxSettings";
import type { CachedProfile } from "./types";

// Shared by invoiceRepository.ts and holdRepository.ts so their pricing/tax
// resolution can never fork into two copies that silently drift.
export async function assembleCartAgainstCache(
	items: CartLine[],
	profile: CachedProfile,
): Promise<AssembledInvoice> {
	const itemRows = await Promise.all(items.map((line) => itemRepository.getByCode(line.item_code)));
	const rateByCode = new Map<string, number>();
	const itemTaxTemplateByCode = new Map<string, string>();
	itemRows.forEach((row, index) => {
		const itemCode = items[index].item_code;
		if (row?.rate != null) {
			rateByCode.set(itemCode, Number(row.price_list_rate ?? row.rate));
		}
		if (row?.item_tax_template) {
			itemTaxTemplateByCode.set(itemCode, row.item_tax_template);
		}
	});

	const taxTemplate = profile.taxes_and_charges
		? await taxTemplateRepository.getByName(profile.taxes_and_charges)
		: undefined;

	const itemTaxTemplateRows = new Map<string, ItemTaxRow[]>();
	for (const templateName of new Set(itemTaxTemplateByCode.values())) {
		const template = await itemTaxTemplateRepository.getByName(templateName);
		if (template) {
			itemTaxTemplateRows.set(templateName, template.taxes);
		}
	}

	const taxSettings = await resolveTaxSettings();

	// Assembly happens before any durable write - if pricing/tax data is missing or
	// the engine hits an unsupported shape, it throws here and nothing is queued (I9).
	return assembleInvoice({
		cart: items,
		priceResolver: (itemCode) => rateByCode.get(itemCode),
		taxRows: taxTemplate?.taxes ?? [],
		itemTaxResolver: (itemCode) => {
			const templateName = itemTaxTemplateByCode.get(itemCode);
			return templateName ? itemTaxTemplateRows.get(templateName) : undefined;
		},
		taxSettings,
		roundingSettings: {
			currencyPrecision: profile.currency_precision,
			disableRoundedTotal: profile.disable_rounded_total,
			smallestCurrencyFractionValue: profile.smallest_currency_fraction_value,
			roundingMethod: profile.rounding_method,
		},
	});
}
