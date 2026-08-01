import { Plus } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { ItemDTO } from "../types";
import { ItemTaxLabel, ItemTaxPrice } from "./ItemTaxPrice";

type ItemCardProps = {
	currency?: string;
	disabled?: boolean;
	item: ItemDTO;
	onAdd: (item: ItemDTO) => void;
};

export function ItemCard({ currency, disabled, item, onAdd }: ItemCardProps) {
	const outOfStock =
		Boolean(item.is_stock_item ?? true) &&
		!item.allow_negative_stock &&
		item.actual_qty !== undefined &&
		Number(item.actual_qty || 0) <= 0;
	const isDisabled = disabled || outOfStock;

	return (
		<div className="flex min-h-40 flex-col overflow-hidden rounded-md border border-outline-variant bg-surface-container-low transition-colors hover:bg-surface-container sm:min-h-44">
			<div
				className={`flex flex-1 flex-col text-left ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
				role="button"
				tabIndex={isDisabled ? -1 : 0}
				aria-disabled={isDisabled}
				onClick={() => { if (!isDisabled) onAdd(item); }}
				onKeyDown={(event) => {
					if (!isDisabled && (event.key === "Enter" || event.key === " ")) {
						event.preventDefault();
						onAdd(item);
					}
				}}
			>
				<div className="flex h-32 shrink-0 items-center justify-center bg-surface-container sm:h-36">
					{item.image ? (
						<img src={item.image} alt="" className="h-full w-full object-cover" />
					) : (
						<span className="px-4 text-center text-sm font-medium text-on-surface-variant">
							{item.item_name}
						</span>
					)}
				</div>
				<div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
					<div>
						<h3 className="line-clamp-2 text-sm font-semibold text-on-surface">{item.item_name}</h3>
						<p className="mt-1 text-xs text-on-surface-variant">{item.item_code}</p>
					</div>
					<div className="mt-auto flex items-center justify-between gap-3">
						<div className="min-w-0 flex-1">
							<ItemTaxLabel item={item} />
							<ItemTaxPrice currency={currency} item={item} />
							{item.actual_qty !== undefined ? (
								<p className={outOfStock ? "text-xs font-medium text-error" : "text-xs text-on-surface-variant"}>
									{outOfStock ? "Out of stock" : `Qty ${item.actual_qty}`}
								</p>
							) : null}
						</div>
						<Button size="sm" className="size-9 shrink-0 p-0" disabled={isDisabled} title={`Add ${item.item_name}`} aria-label={`Add ${item.item_name}`} onClick={(event) => { event.stopPropagation(); onAdd(item); }}>
							<Plus className="size-4" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
