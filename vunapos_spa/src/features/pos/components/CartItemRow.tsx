import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Minus, Plus, RefreshCw, Trash2, WandSparkles } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { BatchAllocationDTO, InvoiceItemDTO, ItemBatchesDTO, PricingOverrideDTO, SerialAllocationDTO } from "../types";
import { formatCurrency } from "../utils";

type CartItemRowProps = {
	allowDiscountChange?: boolean;
	allowRateChange?: boolean;
	currency?: string;
	disabled?: boolean;
	expanded: boolean;
	item: InvoiceItemDTO;
	onRemove: (rowName: string) => void;
	onLoadBatches: (itemCode: string, warehouse: string, isOnline: boolean) => Promise<ItemBatchesDTO>;
	onToggle: (rowName: string) => void;
	onUpdateBatchAllocations: (rowName: string, allocations: BatchAllocationDTO[]) => Promise<void>;
	onUpdateQty: (rowName: string, qty: number) => void;
	onUpdatePricing: (rowName: string, pricingOverride?: PricingOverrideDTO) => Promise<void>;
	onUpdateNote: (rowName: string, note: string) => Promise<void>;
	onUpdateUom: (rowName: string, uom: string, conversionFactor: number) => Promise<void>;
	onUpdateSerialAllocations: (rowName: string, allocations: SerialAllocationDTO[]) => Promise<void>;
	isOnline: boolean;
	warehouse?: string;
};

function plainDescription(description?: string) {
	return description?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function CartItemRow({
	allowDiscountChange,
	allowRateChange,
	currency,
	disabled,
	expanded,
	item,
	onRemove,
	onLoadBatches,
	onToggle,
	onUpdateBatchAllocations,
	onUpdateQty,
	onUpdatePricing,
	onUpdateNote,
	onUpdateUom,
	onUpdateSerialAllocations,
	isOnline,
	warehouse,
}: CartItemRowProps) {
	const [quantity, setQuantity] = useState(String(item.qty));
	const [batchData, setBatchData] = useState<ItemBatchesDTO | null>(null);
	const [batchError, setBatchError] = useState<string | null>(null);
	const [batchExpanded, setBatchExpanded] = useState(false);
	const [serialExpanded, setSerialExpanded] = useState(false);
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
	const isStockItem = item.is_stock_item === undefined ? true : Boolean(item.is_stock_item);
	const isBatchTracked = Boolean(item.has_batch_no || item.batch_no || item.batch_allocations?.length);
	const isSerialTracked = Boolean(item.has_serial_no || item.serial_and_batch_bundle);
	const itemWarehouse = item.warehouse || warehouse || "";
	const stockQuantity = item.qty * Number(item.conversion_factor || 1);
	const projectedQuantity = item.actual_qty == null ? null : Number(item.actual_qty) - stockQuantity;

	useEffect(() => {
		if (!expanded || (!batchExpanded && !serialExpanded) || (!isBatchTracked && !isSerialTracked) || !itemWarehouse || batchData) return;
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
	}, [batchData, batchExpanded, serialExpanded, expanded, isBatchTracked, isOnline, isSerialTracked, item.item_code, itemWarehouse, onLoadBatches]);

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

					<PricingEditor
						key={`${item.uom}-${item.rate}-${item.discount_percentage || 0}-${item.discount_amount || 0}`}
						allowDiscountChange={Boolean(allowDiscountChange)}
						allowRateChange={Boolean(allowRateChange)}
						currency={currency}
						disabled={Boolean(disabled)}
						item={item}
						onUpdate={(override) => onUpdatePricing(item.row_name, override)}
					/>
					{item.pricing_override ? <div className="mt-3 rounded-md border border-tertiary bg-tertiary-container px-3 py-2 text-xs text-on-tertiary-container"><span className="font-semibold">Manual price override:</span> {pricingOverrideLabel(item.pricing_override, currency)}{item.pricing_override_by ? ` · ${item.pricing_override_by}` : " · current cashier"}</div> : item.pricing_rules ? <div className="mt-3 rounded-md bg-secondary-container px-3 py-2 text-xs text-on-secondary-container">Promotion or pricing rule applied: {item.pricing_rules}</div> : null}

					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<label><span className="text-xs font-medium text-on-surface-variant">UOM</span><select className="mt-1 h-9 w-full rounded-md border border-outline-variant bg-surface px-2 text-sm" disabled={disabled || (item.uoms?.length || 0) < 2} value={item.uom || item.stock_uom || ""} onChange={(event) => { const selected = item.uoms?.find((row) => row.uom === event.target.value); if (selected) void onUpdateUom(item.row_name, selected.uom, selected.conversion_factor); }}>{(item.uoms?.length ? item.uoms : [{ uom: item.uom || item.stock_uom || "", conversion_factor: 1 }]).map((row) => <option key={row.uom} value={row.uom}>{row.uom} ({row.conversion_factor} {item.stock_uom})</option>)}</select></label>
						<Detail label="Line amount" value={formatCurrency(item.amount, currency)} strong />
						<Detail label="Warehouse" value={itemWarehouse || "-"} />
						<Detail label="Available quantity" value={item.actual_qty == null ? "Not available" : `${item.actual_qty} ${item.stock_uom || item.uom || ""}`} />
						<Detail label="Projected after sale" value={projectedQuantity == null ? "Not available" : `${projectedQuantity} ${item.stock_uom || item.uom || ""}`} warning={projectedQuantity != null && projectedQuantity <= 0} />
						<Detail label="Tax template" value={item.item_tax_template || "No item tax template"} />
						<Detail label="Barcode" value={item.barcode || "No barcode"} />
					</div>

					<ItemNoteEditor key={item.item_note || "empty-note"} disabled={Boolean(disabled)} item={item} onSave={(note) => onUpdateNote(item.row_name, note)} />

					<div className="mt-4 flex flex-wrap gap-2">
						<Indicator active={isStockItem} label={isStockItem ? "Stock item" : "Non-stock item"} />
						{isBatchTracked ? <Indicator active label="Batch tracked" /> : null}
						{isSerialTracked ? <Indicator active label="Serial tracked" /> : null}
						{item.allow_negative_stock ? <Indicator active label="Negative stock allowed" /> : null}
					</div>

					{isSerialTracked ? <div className="mt-4 overflow-hidden rounded-md border border-outline-variant bg-surface-container-low"><button type="button" className="flex w-full items-center justify-between p-3 text-left" onClick={() => setSerialExpanded((value) => !value)}><span><span className="block text-xs font-medium uppercase tracking-wide text-on-surface-variant">Serial numbers</span><span className="text-xs text-on-surface-variant">{item.serial_allocations?.length || 0} of {item.qty * Number(item.conversion_factor || 1)} selected</span></span><ChevronDown className={`size-4 transition-transform ${serialExpanded ? "rotate-180" : ""}`} /></button>{serialExpanded ? <SerialAllocationEditor data={batchData} disabled={Boolean(disabled)} item={item} onSave={(rows) => onUpdateSerialAllocations(item.row_name, rows)} /> : null}</div> : null}
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

function pricingOverrideLabel(override: PricingOverrideDTO, currency?: string) {
	if (override.type === "rate") return `rate set to ${formatCurrency(override.value, currency)}`;
	if (override.type === "discount_percentage") return `${override.value}% discount`;
	return `${formatCurrency(override.value, currency)} discount`;
}

function ItemNoteEditor({ disabled, item, onSave }: { disabled: boolean; item: InvoiceItemDTO; onSave: (note: string) => Promise<void> }) {
	const [note, setNote] = useState(item.item_note || "");
	const [error, setError] = useState<string | null>(null);
	const save = async () => {
		if (note.trim() === (item.item_note || "")) return;
		try { setError(null); await onSave(note); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Failed to save item note"); }
	};
	return <label className="mt-4 block"><span className="text-xs font-medium text-on-surface-variant">Item note</span><textarea className="mt-1 min-h-20 w-full resize-y rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary" disabled={disabled} maxLength={500} placeholder="Add packing, handling, or cashier notes…" value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur(); }} /><span className="mt-1 flex justify-between text-xs text-on-surface-variant"><span>{error ? <span className="text-error">{error}</span> : "Ctrl/⌘ + Enter to save"}</span><span>{note.length}/500</span></span></label>;
}

function SerialAllocationEditor({ data, disabled, item, onSave }: { data: ItemBatchesDTO | null; disabled: boolean; item: InvoiceItemDTO; onSave: (rows: SerialAllocationDTO[]) => Promise<void> }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(() => new Set((item.serial_allocations || []).map((row) => row.serial_no)));
	const [saving, setSaving] = useState(false);

	const required = item.qty * Number(item.conversion_factor || 1);
	const serials = data?.serials || [];
	const filtered = serials.filter((row) => row.serial_no.toLowerCase().includes(query.toLowerCase()));
	const toggle = (serialNo: string) => setSelected((current) => { const next = new Set(current); if (next.has(serialNo)) next.delete(serialNo); else if (next.size < required) next.add(serialNo); return next; });
	const scan = () => { const exact = serials.find((row) => row.serial_no.toLowerCase() === query.trim().toLowerCase()); if (exact) { toggle(exact.serial_no); setQuery(""); } };
	return <div className="border-t border-outline-variant p-3"><div className="flex gap-2"><input className="h-9 min-w-0 flex-1 rounded-md border border-outline-variant bg-surface px-2 text-sm" placeholder="Scan or search serial number" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); scan(); } }} /><Button size="sm" variant="ghost" onClick={scan}>Add scan</Button></div><div className="mt-3 max-h-56 space-y-2 overflow-y-auto">{filtered.map((row) => <label key={row.serial_no} className="flex items-center gap-2 rounded-md border border-outline-variant bg-surface p-2 text-sm"><input type="checkbox" checked={selected.has(row.serial_no)} disabled={disabled || (!selected.has(row.serial_no) && selected.size >= required)} onChange={() => toggle(row.serial_no)} /><span className="min-w-0 flex-1 truncate">{row.serial_no}</span>{row.batch_no ? <span className="text-xs text-on-surface-variant">{row.batch_no}</span> : null}</label>)}</div><div className="mt-3 flex items-center justify-between"><span className={selected.size === required ? "text-xs text-on-surface-variant" : "text-xs text-error"}>Selected {selected.size} / {required}</span><Button size="sm" disabled={disabled || saving || selected.size !== required || !Number.isInteger(required)} onClick={() => { setSaving(true); void onSave(serials.filter((row) => selected.has(row.serial_no))).finally(() => setSaving(false)); }}>{saving ? "Saving…" : "Save serials"}</Button></div></div>;
}

function PricingEditor({ allowDiscountChange, allowRateChange, currency, disabled, item, onUpdate }: {
	allowDiscountChange: boolean;
	allowRateChange: boolean;
	currency?: string;
	disabled: boolean;
	item: InvoiceItemDTO;
	onUpdate: (override?: PricingOverrideDTO) => Promise<void>;
}) {
	const priceListRate = Number(item.price_list_rate ?? item.rate);
	const [rate, setRate] = useState(String(item.rate));
	const [discountPercentage, setDiscountPercentage] = useState(String(item.discount_percentage || 0));
	const [discountAmount, setDiscountAmount] = useState(String(item.discount_amount || 0));
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const apply = async (type: PricingOverrideDTO["type"], rawValue: string) => {
		const value = Number(rawValue);
		if (!Number.isFinite(value) || value < 0) {
			setError("Enter a valid non-negative amount.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onUpdate({ type, value });
		} catch (updateError) {
			setError(updateError instanceof Error ? updateError.message : "Failed to update pricing");
		} finally {
			setSaving(false);
		}
	};

	const reset = async () => {
		setSaving(true);
		setError(null);
		try {
			await onUpdate(undefined);
			setRate(String(priceListRate));
			setDiscountPercentage("0");
			setDiscountAmount("0");
		} catch (updateError) {
			setError(updateError instanceof Error ? updateError.message : "Failed to reset pricing");
		} finally {
			setSaving(false);
		}
	};

	const changeDiscountPercentage = (rawValue: string) => {
		setDiscountPercentage(rawValue);
		const value = Number(rawValue);
		setDiscountAmount(rawValue !== "" && Number.isFinite(value) ? String(Math.round(priceListRate * value) / 100) : "");
	};

	const changeDiscountAmount = (rawValue: string) => {
		setDiscountAmount(rawValue);
		const value = Number(rawValue);
		setDiscountPercentage(rawValue !== "" && Number.isFinite(value) && priceListRate > 0 ? String(Math.round(value / priceListRate * 10000) / 100) : "");
	};

	return (
		<div className="-mx-3 border-y border-outline-variant bg-surface-container-low p-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Rate and discount</p>
				<Button variant="ghost" size="sm" className={item.pricing_override ? "" : "invisible"} disabled={disabled || saving || !item.pricing_override} onClick={() => void reset()}>Reset</Button>
			</div>
			<div className="mt-3 grid gap-3 sm:grid-cols-2">
				<PriceInput label="Selling rate" value={rate} readOnly={!allowRateChange || disabled} onChange={setRate} onApply={() => apply("rate", rate)} />
				<div><p className="text-xs text-on-surface-variant">Price-list rate</p><div className="mt-1 flex h-9 items-center justify-end rounded-md border border-outline-variant bg-surface-container px-2 text-sm text-on-surface-variant">{formatCurrency(priceListRate, currency)}</div></div>
			</div>
			<div className="mt-3 grid gap-3 sm:grid-cols-2">
				<PriceInput label="Discount %" value={discountPercentage} readOnly={!allowDiscountChange || disabled} max={100} onChange={changeDiscountPercentage} onApply={() => apply("discount_percentage", discountPercentage)} />
				<PriceInput label="Discount amount" value={discountAmount} readOnly={!allowDiscountChange || disabled} onChange={changeDiscountAmount} onApply={() => apply("discount_amount", discountAmount)} />
			</div>
			{error ? <p className="mt-2 text-xs text-error">{error}</p> : null}
		</div>
	);
}

function PriceInput({ label, max, onApply, onChange, readOnly, value }: { label: string; max?: number; onApply: () => void; onChange: (value: string) => void; readOnly?: boolean; value: string }) {
	return <label className="block"><span className="text-xs text-on-surface-variant">{label}</span><input className={`mt-1 h-9 w-full rounded-md border border-outline-variant px-2 text-right text-sm outline-none ${readOnly ? "bg-surface-container text-on-surface-variant" : "bg-surface focus:border-primary"}`} readOnly={readOnly} inputMode="decimal" min="0" max={max} step="any" type="number" value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => { if (!readOnly && value !== "") onApply(); }} onKeyDown={(event) => { if (event.key === "Enter" && !readOnly) event.currentTarget.blur(); }} /></label>;
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
	const requiredQty = item.qty * Number(item.conversion_factor || 1);
	const allocated = parsed.reduce((sum, batch) => sum + (Number.isFinite(batch.qty) ? batch.qty : 0), 0);
	const remaining = requiredQty - allocated;
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
		let required = requiredQty;
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
						<div><span className="text-on-surface-variant">Required</span><p className="font-semibold">{requiredQty}</p></div>
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

function Detail({ label, value, strong = false, warning = false }: { label: string; value: string; strong?: boolean; warning?: boolean }) {
	return (
		<div>
			<p className="text-xs font-medium text-on-surface-variant">{label}</p>
			<p className={`mt-1 text-sm ${strong ? "font-semibold" : "font-medium"} ${warning ? "text-error" : "text-on-surface"}`}>{value}</p>
		</div>
	);
}

function Indicator({ active, label }: { active: boolean; label: string }) {
	return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"}`}>{label}</span>;
}
