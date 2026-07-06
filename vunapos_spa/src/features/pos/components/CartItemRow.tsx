import { Minus, Plus, Trash2 } from "lucide-react";

import type { InvoiceItemDTO } from "../types";
import { formatCurrency } from "../utils";

type CartItemRowProps = {
	currency?: string;
	disabled?: boolean;
	item: InvoiceItemDTO;
	onRemove: (rowName: string) => void;
	onUpdateQty: (rowName: string, qty: number) => void;
};

function getBatchLabel(item: InvoiceItemDTO) {
	if (item.batch_allocations?.length) {
		return item.batch_allocations
			.map((allocation) => `${allocation.batch_no} x ${allocation.qty}`)
			.join(", ");
	}

	if (item.batch_no) {
		return item.batch_no;
	}

	return null;
}

export function CartItemRow({ currency, disabled, item, onRemove, onUpdateQty }: CartItemRowProps) {
	const batchLabel = getBatchLabel(item);

	return (
		<div className="rounded-md border border-outline-variant bg-surface-container-low p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-on-surface">{item.item_name}</p>
					<p className="text-xs text-on-surface-variant">{item.item_code}</p>
					{batchLabel ? (
						<p className="mt-1 truncate text-xs font-medium text-on-surface-variant">
							Batch {batchLabel}
						</p>
					) : null}
				</div>
				<button
					type="button"
					disabled={disabled}
					className="rounded-md p-2 text-error hover:bg-error-container disabled:opacity-50"
					onClick={() => onRemove(item.row_name)}
					aria-label={`Remove ${item.item_name}`}
				>
					<Trash2 className="size-4" />
				</button>
			</div>
			<div className="mt-3 flex items-center justify-between gap-3">
				<div className="flex items-center rounded-md border border-outline-variant bg-surface">
					<button
						type="button"
						disabled={disabled}
						className="flex h-9 w-9 items-center justify-center hover:bg-surface-container-low disabled:opacity-50"
						onClick={() => onUpdateQty(item.row_name, item.qty - 1)}
						aria-label={`Decrease ${item.item_name}`}
					>
						<Minus className="size-4" />
					</button>
					<span className="min-w-10 px-2 text-center text-sm font-semibold">{item.qty}</span>
					<button
						type="button"
						disabled={disabled}
						className="flex h-9 w-9 items-center justify-center hover:bg-surface-container-low disabled:opacity-50"
						onClick={() => onUpdateQty(item.row_name, item.qty + 1)}
						aria-label={`Increase ${item.item_name}`}
					>
						<Plus className="size-4" />
					</button>
				</div>
				<div className="text-right">
					<p className="text-xs text-on-surface-variant">{formatCurrency(item.rate, currency)}</p>
					<p className="text-sm font-semibold text-on-surface">{formatCurrency(item.amount, currency)}</p>
				</div>
			</div>
		</div>
	);
}
