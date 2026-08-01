import { EmptyState } from "../../../components/ui/EmptyState";
import type { ItemDTO } from "../types";
import { ItemCard } from "./ItemCard";
import { ItemListRow } from "./ItemListRow";

type ItemGridProps = {
	currency?: string;
	hideImages?: boolean;
	isLoading?: boolean;
	items?: ItemDTO[];
	pendingItemCode?: string | null;
	onAddItem: (item: ItemDTO) => void;
};

export function ItemGrid({ currency, hideImages, isLoading, items, pendingItemCode, onAddItem }: ItemGridProps) {
	if (isLoading && items?.length === 0) {
		return <EmptyState title="Loading items" description="Fetching items from ERPNext." />;
	}

	if (!isLoading && items?.length === 0) {
		return <EmptyState title="No items found" description="Try another item name, code, or barcode." />;
	}

	return hideImages ? (
		<div>
			{items?.map((item) => <ItemListRow key={item.item_code} currency={currency} disabled={pendingItemCode === item.item_code} item={item} onAdd={onAddItem} />)}
		</div>
	) : (
		<div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
			{items?.map((item) => (
				<ItemCard
					key={item.item_code}
					currency={currency}
					disabled={pendingItemCode === item.item_code}
					item={item}
					onAdd={onAddItem}
				/>
			))}
		</div>
	);
}
