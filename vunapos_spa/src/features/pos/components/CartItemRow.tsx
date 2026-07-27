import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Minus, Plus, RefreshCw, Trash2, WandSparkles } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { BatchAllocationDTO, InvoiceItemDTO, ItemBatchesDTO } from "../types";
import { formatCurrency } from "../utils";

type CartItemRowProps = {
	currency?: string;
	disabled?: boolean;
	expanded: boolean;
	item: InvoiceItemDTO;
	onRemove: (rowName: string) => void;
	onLoadBatches: (itemCode: string, warehouse: string, isOnline: boolean) => Promise<ItemBatchesDTO>;
	onToggle: (rowName: string) => void;
	onUpdateBatchAllocations: (rowName: string, allocations: BatchAllocationDTO[]) => Promise<void>;
	onUpdateQty: (rowName: string, qty: number) => void;
	isOnline: boolean;
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
	onLoadBatches,
	onToggle,
	onUpdateBatchAllocations,
	onUpdateQty,
	isOnline,
	warehouse,
}: CartItemRowProps) {
	const [quantity, setQuantity] = useState(String(item.qty));
	const [batchData, setBatchData] = useState<ItemBatchesDTO | null>(null);
	const [batchError, setBatchError] = useState<string | null>(null);
	const [batchExpanded, setBatchExpanded] = useState(false);
	const requestedBatches = useRef<string | null>(null);

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
	const itemWarehouse = item.warehouse || warehouse || "";

	useEffect(() => {
		if (!expanded || !batchExpanded || !isBatchTracked || isSerialTracked || !itemWarehouse || batchData) return;
		const requestKey = `${item.item_code}:${itemWarehouse}:${isOnline}`;
		if (requestedBatches.current === requestKey) return;
		requestedBatches.current = requestKey;
		onLoadBatches(item.item_code, itemWarehouse, isOnline).then(
			(data) => {
				setBatchData(data);
				setBatchError(null);
			},
			(error: unknown) => setBatchError(error instanceof Error ? error.message : "Failed to load batches"),
		);
	}, [batchData, batchExpanded, expanded, isBatchTracked, isOnline, isSerialTracked, item.item_code, itemWarehouse, onLoadBatches]);

	return (
		<article className="overflow-hidden rounded-md border border-outline-variant bg-surface-container-low">
			<div className="p-3">
				<div className="flex items-start justify-between gap-3">
					<button
						type="button"
						className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
						onClick={() => onToggle(item.row_name)}
						aria-expanded={expanded}
						aria-controls={`cart-item-details-${item.row_name}`}
					>
						<span className="min-w-0">
							<span className="block truncate text-sm font-semibold text-on-surface">{item.item_name}</span>
							<span className="block text-xs text-on-surface-variant">{item.item_code}</span>
						</span>
						<ChevronDown className={`mt-1 size-4 shrink-0 text-on-surface-variant transition-transform ${expanded ? "rotate-180" : ""}`} />
					</button>
					<button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-md text-error hover:bg-error-container disabled:opacity-50" disabled={disabled} onClick={() => onRemove(item.row_name)} aria-label={`Remove ${item.item_name}`}>
						<Trash2 className="size-4" />
					</button>
				</div>
				<div className="mt-3 flex items-center justify-between gap-3">
					<div className="flex items-center overflow-hidden rounded-md border border-outline-variant bg-surface">
						<button type="button" disabled={disabled || item.qty <= 1} className="flex h-10 w-10 items-center justify-center hover:bg-surface-container-low disabled:opacity-50" onClick={() => { setQuantity(String(item.qty - 1)); onUpdateQty(item.row_name, item.qty - 1); }} aria-label={`Decrease ${item.item_name}`}>
							<Minus className="size-4" />
						</button>
						<input
							aria-label={`${item.item_name} quantity`}
							className="h-10 w-14 border-x border-outline-variant bg-surface px-1 text-center text-sm font-semibold outline-none focus:border-primary"
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
					<div className="text-right">
						<p className="text-xs text-on-surface-variant">{item.qty} × {formatCurrency(item.rate, currency)}</p>
						<p className="text-sm font-semibold text-on-surface">{formatCurrency(item.amount, currency)}</p>
					</div>
				</div>
			</div>

			{expanded ? (
				<div id={`cart-item-details-${item.row_name}`} className="border-t border-outline-variant bg-surface p-3">
					{description ? <p className="mb-4 text-xs leading-5 text-on-surface-variant">{description}</p> : null}

					<div className="grid gap-4 sm:grid-cols-2">
						<Detail label="UOM" value={item.uom || item.stock_uom || "-"} />
						<Detail label="Selling rate" value={formatCurrency(item.rate, currency)} />
						<Detail label="Price-list rate" value={formatCurrency(priceListRate, currency)} />
						{discountPercentage > 0 || discountAmount > 0 ? (
							<Detail label="Discount" value={`${discountPercentage ? `${discountPercentage}%` : ""}${discountPercentage && discountAmount ? " · " : ""}${discountAmount ? formatCurrency(discountAmount, currency) : ""}`} />
						) : null}
						<Detail label="Line amount" value={formatCurrency(item.amount, currency)} strong />
						<Detail label="Warehouse" value={itemWarehouse || "-"} />
						<Detail label="Available quantity" value={item.actual_qty == null ? "Not available" : `${item.actual_qty} ${item.stock_uom || item.uom || ""}`} />
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						<Indicator active={isStockItem} label={isStockItem ? "Stock item" : "Non-stock item"} />
						{isBatchTracked ? <Indicator active label="Batch tracked" /> : null}
						{isSerialTracked ? <Indicator active label="Serial tracked" /> : null}
						{item.allow_negative_stock ? <Indicator active label="Negative stock allowed" /> : null}
					</div>

					{isBatchTracked && isSerialTracked ? (
						<div className="mt-4 flex gap-2 rounded-md border border-tertiary bg-tertiary-container p-3 text-sm text-on-tertiary-container">
							<AlertCircle className="size-4 shrink-0" /> This item also requires serial numbers. Manual bundle selection will be added with serial-number support.
						</div>
					) : null}
					{isBatchTracked && !isSerialTracked ? (
						<div className="mt-4 overflow-hidden rounded-md border border-outline-variant bg-surface-container-low">
							<button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface-container" onClick={() => setBatchExpanded((value) => !value)} aria-expanded={batchExpanded}>
								<span><span className="block text-xs font-medium uppercase tracking-wide text-on-surface-variant">Batch allocation</span><span className="mt-1 block text-xs text-on-surface-variant">{item.batch_allocations?.length ? `${item.batch_allocations.length} batch${item.batch_allocations.length === 1 ? "" : "es"} selected` : "Automatic allocation"}</span></span>
								<ChevronDown className={`size-4 text-on-surface-variant transition-transform ${batchExpanded ? "rotate-180" : ""}`} />
							</button>
							{batchExpanded ? <BatchAllocationEditor
								batchData={batchData}
								disabled={Boolean(disabled)}
								error={batchError}
								isOnline={isOnline}
								item={item}
								onReload={() => {
									requestedBatches.current = null;
									setBatchData(null);
									setBatchError(null);
								}}
								onSave={(allocations) => onUpdateBatchAllocations(item.row_name, allocations)}
							/> : null}
						</div>
					) : null}
				</div>
			) : null}
		</article>
	);
}

function BatchAllocationEditor({ batchData, disabled, error, isOnline, item, onReload, onSave }: {
	batchData: ItemBatchesDTO | null;
	disabled: boolean;
	error: string | null;
	isOnline: boolean;
	item: InvoiceItemDTO;
	onReload: () => void;
	onSave: (allocations: BatchAllocationDTO[]) => Promise<void>;
}) {
	const [amounts, setAmounts] = useState<Record<string, string>>(() =>
		Object.fromEntries((item.batch_allocations || []).map((row) => [row.batch_no, String(row.qty)])),
	);
	const [saving, setSaving] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const batches = batchData?.batches || [];
	const parsed = batches.map((batch) => ({
		...batch,
		qty: Number(amounts[batch.batch_no] || 0),
	}));
	const allocated = parsed.reduce((sum, batch) => sum + (Number.isFinite(batch.qty) ? batch.qty : 0), 0);
	const remaining = item.qty - allocated;
	const invalid = parsed.some((batch) => batch.qty < 0 || batch.qty > Number(batch.available_qty || 0));
	const complete = !invalid && Math.abs(remaining) < 0.000001 && allocated > 0;

	const save = async (rows = parsed) => {
		setSaving(true);
		setActionError(null);
		try {
			await onSave(rows.filter((row) => row.qty > 0).map((row) => ({
				batch_no: row.batch_no,
				qty: row.qty,
				expiry_date: row.expiry_date,
				available_qty: row.available_qty,
			})));
		} catch (saveError) {
			setActionError(saveError instanceof Error ? saveError.message : "Failed to save the batch allocation");
		} finally {
			setSaving(false);
		}
	};

	const selectAutomatic = async () => {
		setSaving(true);
		setActionError(null);
		try {
			await onSave([]);
			setAmounts({});
		} catch (saveError) {
			setActionError(saveError instanceof Error ? saveError.message : "Failed to clear the batch allocation");
		} finally {
			setSaving(false);
		}
	};

	const autoAllocate = () => {
		let required = item.qty;
		const next: Record<string, string> = {};
		for (const batch of batches) {
			const qty = Math.min(required, Number(batch.available_qty || 0));
			if (qty > 0) next[batch.batch_no] = String(qty);
			required -= qty;
		}
		setAmounts(next);
	};

	return (
		<div className="border-t border-outline-variant p-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					{batchData?.verified_at ? <p className="mt-1 text-xs text-on-surface-variant">{batchData.from_cache ? "Cached" : "Verified"} {new Date(batchData.verified_at).toLocaleString()}</p> : null}
				</div>
				<Button variant="ghost" size="sm" className="gap-1" disabled={disabled || !isOnline} onClick={onReload} title={isOnline ? "Refresh batch availability" : "Reconnect to refresh batches"}>
					<RefreshCw className="size-3.5" /> Refresh
				</Button>
			</div>
			{error ? <div className="mt-3 flex gap-2 text-sm text-error"><AlertCircle className="size-4 shrink-0" />{error}</div> : null}
			{actionError ? <div className="mt-3 flex gap-2 text-sm text-error"><AlertCircle className="size-4 shrink-0" />{actionError}</div> : null}
			{!batchData && !error ? <p className="mt-3 text-sm text-on-surface-variant">Loading batch availability…</p> : null}
			{batchData ? (
				<>
					<div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-surface p-2 text-center text-xs">
						<div><span className="text-on-surface-variant">Required</span><p className="font-semibold">{item.qty}</p></div>
						<div><span className="text-on-surface-variant">Allocated</span><p className="font-semibold">{allocated}</p></div>
						<div><span className="text-on-surface-variant">Remaining</span><p className={remaining < 0 ? "font-semibold text-error" : "font-semibold"}>{remaining}</p></div>
					</div>
					<div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
						{batches.map((batch) => (
							<label key={batch.batch_no} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 rounded-md border border-outline-variant bg-surface p-2">
								<span className="min-w-0"><span className="block truncate text-sm font-medium">{batch.batch_no}</span><span className="text-xs text-on-surface-variant">Available {batch.available_qty || 0} · {batch.expiry_date ? `Expires ${batch.expiry_date}` : "No expiry"}</span></span>
								<input aria-label={`${batch.batch_no} allocation`} className="h-9 w-full rounded-md border border-outline-variant bg-surface px-2 text-right text-sm" disabled={disabled || saving} inputMode="decimal" min="0" max={Number(batch.available_qty || 0)} step="any" type="number" value={amounts[batch.batch_no] || ""} onChange={(event) => setAmounts((current) => ({ ...current, [batch.batch_no]: event.target.value }))} />
							</label>
						))}
						{!batches.length ? <p className="text-sm text-on-surface-variant">No valid batches currently have stock.</p> : null}
					</div>
					{invalid ? <p className="mt-2 text-xs text-error">An allocation cannot exceed the batch availability.</p> : null}
					<div className="mt-3 flex flex-wrap gap-2">
						<Button variant="ghost" size="sm" className="gap-1" disabled={disabled || saving || !batches.length} onClick={autoAllocate}><WandSparkles className="size-3.5" /> Auto allocate FEFO</Button>
						<Button variant="ghost" size="sm" disabled={disabled || saving || !item.batch_allocations?.length} onClick={() => void selectAutomatic()}>Use automatic</Button>
						<Button size="sm" className="ml-auto" disabled={disabled || saving || !complete} onClick={() => void save()}>{saving ? "Saving…" : "Save allocation"}</Button>
					</div>
				</>
			) : null}
		</div>
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
