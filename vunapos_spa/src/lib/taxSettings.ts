import type { EngineTaxSettings } from "./invoiceEngine";
import { META_KEYS, metaRepository } from "./repositories/metaRepository";
import type { TaxSettings } from "./types";

// Converts server-shaped tax_settings (synced at bootstrap) into the Invoice
// Engine's input shape. Defaults to ERPNext's classic profile-level template for the
// case a sale is attempted before this ever synced - in practice unreachable since
// BootstrapGate writes tax_settings in the same atomic transaction as everything else.
export async function resolveTaxSettings(): Promise<EngineTaxSettings> {
	const raw = await metaRepository.get<TaxSettings>(META_KEYS.taxSettings);
	return {
		addTaxesFromItemTaxTemplate: raw?.add_taxes_from_item_tax_template ?? false,
		addTaxesFromTaxesAndChargesTemplate: raw?.add_taxes_from_taxes_and_charges_template ?? true,
	};
}
