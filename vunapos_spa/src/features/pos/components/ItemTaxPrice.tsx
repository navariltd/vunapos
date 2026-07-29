import type { ItemDTO } from "../types";
import { formatCurrency } from "../utils";

type ItemTaxPriceProps = {
	currency?: string;
	item: ItemDTO;
	align?: "left" | "right";
};

export function ItemTaxLabel({ item, reserveSpace = false }: { item: ItemDTO; reserveSpace?: boolean }) {
	const tax = item.item_tax;
	if (!tax || tax.tax_rate <= 0) {
		return reserveSpace ? <span aria-hidden="true" className="block h-4" /> : null;
	}
	return (
		<p className="text-xs text-on-surface-variant" title={tax.template}>
			{tax.inclusive_tax_rate > 0 && tax.exclusive_tax_rate > 0
				? `Mixed tax · ${tax.tax_rate}%`
				: tax.inclusive
					? `Tax incl. · ${tax.tax_rate}%`
					: `Tax excl. · ${tax.tax_rate}%`}
		</p>
	);
}

export function ItemTaxPrice({ currency, item, align = "left" }: ItemTaxPriceProps) {
	const tax = item.item_tax;
	const alignment = align === "right" ? "text-right" : "text-left";
	if (!tax || tax.tax_rate <= 0) {
		return <p className={`text-sm font-semibold text-on-surface ${alignment}`}>{formatCurrency(item.rate, currency)}</p>;
	}

	if (tax.inclusive) {
		return (
			<div className={alignment} title={tax.template}>
				<p className="text-sm font-semibold text-on-surface">{formatCurrency(tax.gross_rate, currency)}</p>
			</div>
		);
	}

	return (
		<div className={alignment} title={tax.template}>
			<p className="text-sm font-semibold text-on-surface">{formatCurrency(tax.gross_rate, currency)}</p>
		</div>
	);
}
