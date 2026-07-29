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
	const effectiveRate = tax?.tax_rate ? tax.gross_rate : Number(item.rate || 0);
	const originalRate = Number(item.price_list_rate ?? item.rate ?? 0);
	const originalDisplayRate = Number(item.rate || 0) > 0
		? effectiveRate * (originalRate / Number(item.rate))
		: originalRate;
	const hasPricingDiscount = Boolean(item.pricing_rule && originalDisplayRate > effectiveRate);
	const price = (
		<div className={alignment} title={item.pricing_rule?.pricing_rules.join(", ") || tax?.template}>
			{hasPricingDiscount ? (
				<p className="text-xs text-on-surface-variant line-through">{formatCurrency(originalDisplayRate, currency)}</p>
			) : null}
			<p className="text-sm font-semibold text-on-surface">{formatCurrency(effectiveRate, currency)}</p>
			{hasPricingDiscount ? (
				<p className="text-xs font-medium text-primary">{item.pricing_rule?.discount_percentage}% off</p>
			) : null}
		</div>
	);
	if (!tax || tax.tax_rate <= 0) {
		return price;
	}
	return price;
}
