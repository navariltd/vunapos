// The Invoice Engine (§7.2, I9). Pure: no I/O, no Date.now(), no randomness.
// Deliberately scoped to this codebase's actual tax config (N9), not a generic
// ERPNext replica - it throws loudly on an unsupported shape rather than
// mis-computing silently; treat that throw as a signal to extend this file.
//
// Two independent tax mechanisms exist in ERPNext, gated by Accounts Settings and
// synced as tax_settings (not assumed): profile-level (one rate on net_total,
// supports inclusive) and item-level (flat % per item's own line amount whose
// inclusivity is controlled by the POS Profile). Both can be active at once; their
// contributions to the same account simply add.
//
// Pricing starts from the current in-memory bootstrap rate. The server independently
// resolves customer pricing and recalculates the invoice before checkout.

export type CartLine = {
	item_code: string;
	qty: number;
	uom?: string;
	conversion_factor?: number;
	batch_allocations?: Array<{ batch_no: string; qty: number }>;
	serial_allocations?: Array<{ serial_no: string; batch_no?: string | null }>;
	pricing_override?: {
		type: "rate" | "discount_percentage" | "discount_amount";
		value: number;
	};
};

export type TaxTemplateRow = {
	account_head?: string;
	charge_type?: string;
	rate?: number;
	included_in_print_rate?: boolean;
	description?: string;
};

export type ItemTaxRow = {
	account_head: string;
	rate: number;
	included_in_print_rate?: boolean;
};

export type PriceResolver = (itemCode: string, line?: CartLine) => number | undefined;
export type ItemTaxResolver = (itemCode: string) => ItemTaxRow[] | undefined;

export type EngineTaxSettings = {
	addTaxesFromItemTaxTemplate: boolean;
	addTaxesFromTaxesAndChargesTemplate: boolean;
};

export type EngineRoundingSettings = {
	currencyPrecision?: number;
	disableRoundedTotal?: boolean;
	smallestCurrencyFractionValue?: number | null;
	roundingMethod?: string;
};

export type AssembledInvoiceItem = {
	item_code: string;
	qty: number;
	uom?: string;
	conversion_factor?: number;
	rate: number;
	amount: number;
	price_list_rate?: number;
	discount_percentage?: number;
	discount_amount?: number;
	pricing_override?: CartLine["pricing_override"];
};

export type AssembledTaxRow = {
	account_head?: string;
	charge_type?: string;
	rate: number;
	tax_amount: number;
	total: number;
	included_in_print_rate: boolean;
	description?: string;
};

export type AssembledInvoice = {
	items: AssembledInvoiceItem[];
	taxes: AssembledTaxRow[];
	totals: {
		net_total: number;
		total_taxes_and_charges: number;
		grand_total: number;
		rounded_total: number;
		rounding_adjustment: number;
	};
};

export class InvoiceEngineError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvoiceEngineError";
	}
}

const SUPPORTED_CHARGE_TYPE = "On Net Total";
const CURRENCY_PRECISION = 2;

function round(value: number, precision = CURRENCY_PRECISION): number {
	const factor = 10 ** precision;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundBasedOnSmallestCurrencyFraction(
	value: number,
	settings?: EngineRoundingSettings,
): number {
	const precision = settings?.currencyPrecision ?? CURRENCY_PRECISION;
	if (!settings) return round(value, precision);
	const fraction = Number(settings?.smallestCurrencyFractionValue || 0);
	if (!(fraction > 0)) {
		const absolute = Math.abs(value);
		const floor = Math.floor(absolute);
		const decimal = Number((absolute - floor).toFixed(8));
		let roundedAbsolute: number;
		if (decimal === 0.5) {
			if (settings?.roundingMethod === "Commercial Rounding") {
				roundedAbsolute = floor + 1;
			} else {
				roundedAbsolute = floor % 2 === 0 ? floor : floor + 1;
			}
		} else {
			roundedAbsolute = Math.round(absolute);
		}
		return round(Math.sign(value) * roundedAbsolute, precision);
	}

	// Mirrors frappe.utils.data.round_based_on_smallest_currency_fraction:
	// an exact half fraction rounds down; values above half round up.
	const factor = 10 ** precision;
	const integerValue = Math.round(value * factor);
	const integerFraction = Math.round(fraction * factor);
	if (!(integerFraction > 0)) return round(value, precision);
	const remainder = integerValue % integerFraction;
	const roundedInteger = remainder > integerFraction / 2
		? integerValue + integerFraction - remainder
		: integerValue - remainder;
	return roundedInteger / factor;
}

type AccountTotal = {
	account_head: string;
	rate: number;
	tax_amount: number;
	charge_type?: string;
	included_in_print_rate: boolean;
	description?: string;
};

function addToAccount(
	accounts: Map<string, AccountTotal>,
	key: string,
	amount: number,
	meta: Partial<Omit<AccountTotal, "account_head" | "tax_amount">>,
): void {
	const existing = accounts.get(key);
	if (existing) {
		existing.tax_amount = round(existing.tax_amount + amount);
		return;
	}
	accounts.set(key, {
		account_head: key,
		rate: meta.rate ?? 0,
		tax_amount: amount,
		charge_type: meta.charge_type,
		included_in_print_rate: meta.included_in_print_rate ?? false,
		description: meta.description,
	});
}

export function assembleInvoice(input: {
	cart: CartLine[];
	priceResolver: PriceResolver;
	taxSettings: EngineTaxSettings;
	taxRows?: TaxTemplateRow[] | null;
	itemTaxResolver?: ItemTaxResolver;
	roundingSettings?: EngineRoundingSettings;
}): AssembledInvoice {
	if (!input.cart.length) {
		throw new InvoiceEngineError("Cannot assemble an invoice from an empty cart");
	}

	const items: AssembledInvoiceItem[] = input.cart.map((line) => {
		if (!(line.qty > 0)) {
			throw new InvoiceEngineError(`Quantity for ${line.item_code} must be greater than zero`);
		}
		const rate = input.priceResolver(line.item_code, line);
		if (rate === undefined) {
			throw new InvoiceEngineError(`No price is available for item ${line.item_code}`);
		}
		const priceListRate = rate;
		let sellingRate = priceListRate;
		let discountPercentage = 0;
		let discountAmount = 0;
		const override = line.pricing_override;
		if (override) {
			if (!Number.isFinite(override.value) || override.value < 0) {
				throw new InvoiceEngineError(`Invalid price override for ${line.item_code}`);
			}
			if (override.type === "rate") sellingRate = override.value;
			else if (override.type === "discount_percentage") {
				if (override.value > 100) throw new InvoiceEngineError(`Discount for ${line.item_code} cannot exceed 100%`);
				discountPercentage = override.value;
				discountAmount = round(priceListRate * discountPercentage / 100);
				sellingRate = round(priceListRate - discountAmount);
			} else if (override.type === "discount_amount") {
				if (override.value > priceListRate) throw new InvoiceEngineError(`Discount for ${line.item_code} cannot exceed its price-list rate`);
				discountAmount = override.value;
				discountPercentage = priceListRate ? round(discountAmount / priceListRate * 100) : 0;
				sellingRate = round(priceListRate - discountAmount);
			}
		}
		return {
			item_code: line.item_code,
			qty: line.qty,
			uom: line.uom,
			conversion_factor: line.conversion_factor,
			rate: sellingRate,
			amount: round(sellingRate * line.qty),
			price_list_rate: priceListRate,
			discount_percentage: discountPercentage,
			discount_amount: discountAmount,
			pricing_override: override,
		};
	});

	const taxRows = input.taxSettings.addTaxesFromTaxesAndChargesTemplate ? (input.taxRows ?? []) : [];
	for (const row of taxRows) {
		if (row.charge_type && row.charge_type !== SUPPORTED_CHARGE_TYPE) {
			throw new InvoiceEngineError(
				`Unsupported tax charge type "${row.charge_type}" on account ${row.account_head ?? "?"} - ` +
				`the client Invoice Engine only implements "${SUPPORTED_CHARGE_TYPE}" (see N9/ADR-005: ` +
				"scoped to this client's actual configuration, not a generic replica of ERPNext's tax engine).",
			);
		}
	}

	// A matching Item Tax Template account overrides the profile template's rate for
	// that item, while the profile row still controls whether the tax is included in
	// the entered rate. Item-only accounts use the POS Profile fallback supplied by
	// the item resolver. This mirrors ERPNext's item_wise_tax_detail behaviour.
	const getEffectiveTaxRows = (itemCode: string): Array<TaxTemplateRow & { account_head: string; rate: number }> => {
		const rowsByAccount = new Map<string, TaxTemplateRow & { account_head: string; rate: number }>();
		for (const row of taxRows) {
			const accountHead = row.account_head ?? "unknown";
			rowsByAccount.set(accountHead, { ...row, account_head: accountHead, rate: row.rate ?? 0 });
		}
		const itemRows = input.taxSettings.addTaxesFromItemTaxTemplate && input.itemTaxResolver
			? (input.itemTaxResolver(itemCode) ?? [])
			: [];
		for (const row of itemRows) {
			const profileRow = rowsByAccount.get(row.account_head);
			rowsByAccount.set(row.account_head, {
				...profileRow,
				account_head: row.account_head,
				rate: row.rate,
				included_in_print_rate: profileRow
					? profileRow.included_in_print_rate
					: row.included_in_print_rate,
			});
		}
		return Array.from(rowsByAccount.values());
	};
	const getItemNetAmount = (item: AssembledInvoiceItem, rows: Array<TaxTemplateRow & { rate: number }>) => {
		const inclusiveItemRate = rows
			.filter((row) => row.included_in_print_rate)
			.reduce((sum, row) => sum + row.rate, 0);
		return round(item.amount / (1 + inclusiveItemRate / 100));
	};
	const netTotal = round(items.reduce((sum, item) => {
		const rows = getEffectiveTaxRows(item.item_code);
		return sum + getItemNetAmount(item, rows);
	}, 0));

	const accounts = new Map<string, AccountTotal>();
	for (const item of items) {
		const rows = getEffectiveTaxRows(item.item_code);
		const itemNetAmount = getItemNetAmount(item, rows);
		for (const row of rows) {
			const contribution = round(itemNetAmount * (row.rate / 100));
			addToAccount(accounts, row.account_head, contribution, {
				rate: row.rate,
				charge_type: row.charge_type,
				included_in_print_rate: row.included_in_print_rate,
				description: row.description,
			});
		}
	}

	let runningTotal = netTotal;
	const taxes: AssembledTaxRow[] = Array.from(accounts.values()).map((account) => {
		runningTotal = round(runningTotal + account.tax_amount);
		return {
			account_head: account.account_head,
			charge_type: account.charge_type,
			rate: account.rate,
			tax_amount: account.tax_amount,
			total: runningTotal,
			included_in_print_rate: account.included_in_print_rate,
			description: account.description,
		};
	});

	const totalTaxesAndCharges = round(taxes.reduce((sum, row) => sum + row.tax_amount, 0));
	const grandTotal = round(netTotal + totalTaxesAndCharges);
	const roundedTotal = input.roundingSettings?.disableRoundedTotal
		? 0
		: roundBasedOnSmallestCurrencyFraction(grandTotal, input.roundingSettings);
	const roundingAdjustment = input.roundingSettings?.disableRoundedTotal
		? 0
		: round(roundedTotal - grandTotal);

	return {
		items,
		taxes,
		totals: {
			net_total: netTotal,
			total_taxes_and_charges: totalTaxesAndCharges,
			grand_total: grandTotal,
			rounded_total: roundedTotal,
			rounding_adjustment: roundingAdjustment,
		},
	};
}
