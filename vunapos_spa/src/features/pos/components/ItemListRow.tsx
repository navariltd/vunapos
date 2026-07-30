import { Plus } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { ItemDTO } from "../types";
import { ItemTaxLabel, ItemTaxPrice } from "./ItemTaxPrice";

type ItemListRowProps = {
	currency?: string;
	disabled?: boolean;
	item: ItemDTO;
	onAdd: (item: ItemDTO) => void;
};

export function ItemListRow({ currency, disabled, item, onAdd }: ItemListRowProps) {
	const outOfStock = Boolean(item.is_stock_item ?? true)
		&& !item.allow_negative_stock
		&& item.actual_qty !== undefined
		&& Number(item.actual_qty || 0) <= 0;
	const isDisabled = disabled || outOfStock;

	return (
		<div className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-outline-variant px-3 py-3 transition-colors hover:bg-surface-container sm:grid-cols-[minmax(0,1fr)_12rem_8rem_5rem] sm:px-4 md:grid-cols-[20rem_12rem_minmax(7rem,1fr)_5rem]">
			<button type="button" className="min-w-0 cursor-pointer text-left disabled:cursor-not-allowed" disabled={isDisabled} onClick={() => onAdd(item)}>
				<span className="block truncate text-sm font-semibold text-on-surface">{item.item_name}</span>
				<span className="block truncate text-xs text-on-surface-variant">{[item.item_code, item.item_group, item.stock_uom].filter(Boolean).join(" · ")}</span>
				<ItemTaxLabel item={item} reserveSpace />
			</button>
			<div className="text-right sm:order-none sm:text-left">
				<ItemTaxPrice currency={currency} item={item} align="right" />
				<p className={outOfStock ? "text-xs font-medium text-error sm:hidden" : "text-xs text-on-surface-variant sm:hidden"}>{outOfStock ? "Out of stock" : item.actual_qty === undefined ? "" : `Qty ${item.actual_qty}`}</p>
			</div>
			<p className={outOfStock ? "hidden pl-6 text-left text-sm font-medium text-error sm:block" : "hidden pl-6 text-left text-sm text-on-surface-variant sm:block"}>{outOfStock ? "Out of stock" : item.actual_qty === undefined ? "—" : `${item.actual_qty} ${item.stock_uom || ""}`}</p>
			<Button
				size="sm"
				className="flex size-9 shrink-0 gap-1 p-0 sm:h-9 sm:w-auto sm:px-2"
				disabled={isDisabled}
				onClick={() => onAdd(item)}
				aria-label={`Add ${item.item_name}`}
			>
				<Plus className="size-4" /> <span className="hidden sm:inline">Add</span>
			</Button>
		</div>
	);
}
