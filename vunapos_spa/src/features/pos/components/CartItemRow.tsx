import { useState } from "react";
import { ChevronDown, Minus, Plus, Trash2 } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { InvoiceItemDTO } from "../types";
import { formatCurrency } from "../utils";

type CartItemRowProps = {
	currency?: string;
	disabled?: boolean;
	expanded: boolean;
	item: InvoiceItemDTO;
	onRemove: (rowName: string) => void;
	onToggle: (rowName: string) => void;
	onUpdateQty: (rowName: string, qty: number) => void;
	warehouse?: string;
};

function plainDescription(description?: string) {
	return description?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function CartItemRow({
	currency,
	disabled,
	expanded,
	item,
	onRemove,
	onToggle,
	onUpdateQty,
	warehouse,
}: CartItemRowProps) {
	const [quantity, setQuantity] = useState(String(item.qty));

	const commitQuantity = () => {
		const nextQuantity = Number(quantity);
		if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
			setQuantity(String(item.qty));
			return;
		}
		if (nextQuantity !== item.qty) onUpdateQty(item.row_name, nextQuantity);
	};

	const description = plainDescription(item.description);
	const priceListRate = Number(item.price_list_rate ?? item.rate);
	const discountPercentage = Number(item.discount_percentage || 0);
	const discountAmount = Number(item.discount_amount || Math.max(priceListRate - Number(item.rate), 0));
	const isStockItem = item.is_stock_item === undefined ? true : Boolean(item.is_stock_item);
	const isBatchTracked = Boolean(item.has_batch_no || item.batch_no || item.batch_allocations?.length);
	const isSerialTracked = Boolean(item.has_serial_no || item.serial_and_batch_bundle);

	return (
		<article className="overflow-hidden rounded-md border border-outline-variant bg-surface-container-low">
			<button
				type="button"
				className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-surface-container"
				onClick={() => onToggle(item.row_name)}
				aria-expanded={expanded}
				aria-controls={`cart-item-details-${item.row_name}`}
			>
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-on-surface">{item.item_name}</p>
					<p className="text-xs text-on-surface-variant">{item.item_code}</p>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<div className="text-right">
						<p className="text-xs text-on-surface-variant">{item.qty} × {formatCurrency(item.rate, currency)}</p>
						<p className="text-sm font-semibold text-on-surface">{formatCurrency(item.amount, currency)}</p>
					</div>
					<ChevronDown className={`size-4 text-on-surface-variant transition-transform ${expanded ? "rotate-180" : ""}`} />
				</div>
			</button>

			{expanded ? (
				<div id={`cart-item-details-${item.row_name}`} className="border-t border-outline-variant bg-surface p-3">
					{description ? <p className="mb-4 text-xs leading-5 text-on-surface-variant">{description}</p> : null}

					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<p className="text-xs font-medium text-on-surface-variant">Quantity</p>
							<div className="mt-1 flex items-center rounded-md border border-outline-variant bg-surface">
								<button type="button" disabled={disabled || item.qty <= 1} className="flex h-10 w-10 items-center justify-center hover:bg-surface-container-low disabled:opacity-50" onClick={() => { setQuantity(String(item.qty - 1)); onUpdateQty(item.row_name, item.qty - 1); }} aria-label={`Decrease ${item.item_name}`}>
									<Minus className="size-4" />
								</button>
								<input
									aria-label={`${item.item_name} quantity`}
									className="h-10 min-w-0 flex-1 border-x border-outline-variant bg-surface px-2 text-center text-sm font-semibold outline-none focus:border-primary"
									disabled={disabled}
									inputMode="decimal"
									min="0.000001"
									step="any"
									type="number"
									value={quantity}
									onChange={(event) => setQuantity(event.target.value)}
									onBlur={commitQuantity}
									onKeyDown={(event) => {
										if (event.key === "Enter") event.currentTarget.blur();
										if (event.key === "Escape") setQuantity(String(item.qty));
									}}
								/>
								<button type="button" disabled={disabled} className="flex h-10 w-10 items-center justify-center hover:bg-surface-container-low disabled:opacity-50" onClick={() => { setQuantity(String(item.qty + 1)); onUpdateQty(item.row_name, item.qty + 1); }} aria-label={`Increase ${item.item_name}`}>
									<Plus className="size-4" />
								</button>
							</div>
						</div>
						<Detail label="UOM" value={item.uom || item.stock_uom || "-"} />
						<Detail label="Selling rate" value={formatCurrency(item.rate, currency)} />
						<Detail label="Price-list rate" value={formatCurrency(priceListRate, currency)} />
						{discountPercentage > 0 || discountAmount > 0 ? (
							<Detail label="Discount" value={`${discountPercentage ? `${discountPercentage}%` : ""}${discountPercentage && discountAmount ? " · " : ""}${discountAmount ? formatCurrency(discountAmount, currency) : ""}`} />
						) : null}
						<Detail label="Line amount" value={formatCurrency(item.amount, currency)} strong />
						<Detail label="Warehouse" value={item.warehouse || warehouse || "-"} />
						<Detail label="Available quantity" value={item.actual_qty == null ? "Not available" : `${item.actual_qty} ${item.stock_uom || item.uom || ""}`} />
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						<Indicator active={isStockItem} label={isStockItem ? "Stock item" : "Non-stock item"} />
						{isBatchTracked ? <Indicator active label="Batch tracked" /> : null}
						{isSerialTracked ? <Indicator active label="Serial tracked" /> : null}
						{item.allow_negative_stock ? <Indicator active label="Negative stock allowed" /> : null}
					</div>

					{isBatchTracked ? (
						<div className="mt-4 rounded-md border border-outline-variant bg-surface-container-low p-3">
							<p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Batch allocation</p>
							{item.batch_allocations?.length ? (
								<div className="mt-2 space-y-2">
									{item.batch_allocations.map((allocation) => (
										<div key={allocation.batch_no} className="flex justify-between gap-3 text-sm">
											<span className="font-medium text-on-surface">{allocation.batch_no}</span>
											<span className="text-on-surface-variant">{allocation.qty} {item.uom || ""}{allocation.expiry_date ? ` · Expires ${allocation.expiry_date}` : ""}</span>
										</div>
									))}
								</div>
							) : item.batch_no ? (
								<p className="mt-2 text-sm font-medium text-on-surface">{item.batch_no}</p>
							) : (
								<p className="mt-2 text-sm text-on-surface-variant">Batch will be allocated automatically.</p>
							)}
						</div>
					) : null}

					<div className="mt-4 flex justify-end border-t border-outline-variant pt-3">
						<Button variant="danger" size="sm" className="gap-2" disabled={disabled} onClick={() => onRemove(item.row_name)}>
							<Trash2 className="size-4" /> Remove item
						</Button>
					</div>
				</div>
			) : null}
		</article>
	);
}

function Detail({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
	return (
		<div>
			<p className="text-xs font-medium text-on-surface-variant">{label}</p>
			<p className={`mt-1 text-sm ${strong ? "font-semibold" : "font-medium"} text-on-surface`}>{value}</p>
		</div>
	);
}

function Indicator({ active, label }: { active: boolean; label: string }) {
	return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"}`}>{label}</span>;
}
