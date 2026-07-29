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
			<button
				type="button"
				className="flex flex-1 cursor-pointer flex-col text-left disabled:cursor-not-allowed"
				disabled={isDisabled}
				onClick={() => onAdd(item)}
			>
				<div className="flex aspect-[4/3] items-center justify-center bg-surface-container">
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
						<div>
							<ItemTaxLabel item={item} />
							<ItemTaxPrice currency={currency} item={item} />
							{item.actual_qty !== undefined ? (
								<p className={outOfStock ? "text-xs font-medium text-error" : "text-xs text-on-surface-variant"}>
									{outOfStock ? "Out of stock" : `Qty ${item.actual_qty}`}
								</p>
							) : null}
						</div>
						<Button size="sm" className="pointer-events-none gap-1 px-2" disabled={isDisabled} tabIndex={-1}>
							<Plus className="size-4" />
							<span className="hidden sm:inline">Add</span>
						</Button>
					</div>
				</div>
			</button>
		</div>
	);
}
