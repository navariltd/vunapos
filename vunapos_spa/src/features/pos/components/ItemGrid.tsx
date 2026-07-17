import { EmptyState } from "../../../components/ui/EmptyState";
import type { ItemDTO } from "../types";
import { ItemCard } from "./ItemCard";

type ItemGridProps = {
	currency?: string;
	isLoading?: boolean;
	items?: ItemDTO[];
	mutationDisabled?: boolean;
	onAddItem: (item: ItemDTO) => void;
};

export function ItemGrid({ currency, isLoading, items, mutationDisabled, onAddItem }: ItemGridProps) {
	if (isLoading && items?.length === 0) {
		return <EmptyState title="Loading items" description="Fetching items from ERPNext." />;
	}

	if (!isLoading && items?.length === 0) {
		return <EmptyState title="No items found" description="Try another item name, code, or barcode." />;
	}

	return (
		<div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
			{items?.map((item) => (
				<ItemCard
					key={item.item_code}
					currency={currency}
					disabled={mutationDisabled}
					item={item}
					onAdd={onAddItem}
				/>
			))}
		</div>
	);
}
