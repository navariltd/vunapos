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
	onUpdateQty: (rowName: string, qty: number) => Promise<void>;
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

	const commitQuantity = async () => {
		const nextQuantity = Number(quantity);
		if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
			setQuantity(String(item.qty));
			return;
		}
		if (nextQuantity !== item.qty) {
			try {
				await onUpdateQty(item.row_name, nextQuantity);
			} catch {
				setQuantity(String(item.qty));
			}
		}
	};

	const description = plainDescription(item.description);
	const isBatchTracked = Boolean(item.has_batch_no || item.batch_no || item.batch_allocations?.length);
	const isSerialTracked = Boolean(item.has_serial_no || item.serial_and_batch_bundle);
	const itemWarehouse = item.warehouse || warehouse || "";
	const itemDisabled = Boolean(disabled || item.is_free_item);

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
		<article className={`overflow-hidden rounded-md border bg-surface-container-low transition-colors ${expanded ? "border-primary shadow-sm" : "border-outline-variant"}`}>
			<div className={expanded ? "bg-surface-container p-3" : "p-3"}>
				<div className="flex items-start justify-between gap-3">
					<button
						type="button"
						className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-3 text-left"
						onClick={() => { if (!item.is_free_item) onToggle(item.row_name); }}
						aria-expanded={expanded}
						aria-controls={`cart-item-details-${item.row_name}`}
					>
						<span className="min-w-0">
							<span className="flex items-center gap-2"><span className="block truncate text-sm font-semibold text-on-surface">{item.item_name}</span>{item.is_free_item ? <span className="rounded-full bg-primary-container px-2 py-0.5 text-[10px] font-semibold uppercase text-on-primary-container">Free item</span> : null}</span>
							<span className="block text-xs text-on-surface-variant">{item.item_code}</span>
						</span>
						<ChevronDown className={`mt-1 size-4 shrink-0 text-on-surface-variant transition-transform ${expanded ? "rotate-180" : ""}`} />
					</button>
					<button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-md text-error hover:bg-error-container disabled:opacity-50" disabled={itemDisabled} onClick={() => onRemove(item.row_name)} aria-label={`Remove ${item.item_name}`}>
						<Trash2 className="size-4" />
					</button>
				</div>
				<div className="mt-3 flex items-center justify-between gap-3">
					<div className="flex items-center overflow-hidden rounded-md border border-outline-variant bg-surface">
						<button type="button" disabled={itemDisabled || item.qty <= 1} className="flex h-10 w-10 items-center justify-center hover:bg-surface-container-low disabled:opacity-50" onClick={() => { setQuantity(String(item.qty - 1)); void onUpdateQty(item.row_name, item.qty - 1).catch(() => setQuantity(String(item.qty))); }} aria-label={`Decrease ${item.item_name}`}>
							<Minus className="size-4" />
						</button>
						<input
							aria-label={`${item.item_name} quantity`}
							className="h-10 w-14 border-x border-outline-variant bg-surface px-1 text-center text-sm font-semibold outline-none focus:border-primary"
							disabled={itemDisabled}
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
						<button type="button" disabled={itemDisabled} className="flex h-10 w-10 items-center justify-center hover:bg-surface-container-low disabled:opacity-50" onClick={() => { setQuantity(String(item.qty + 1)); void onUpdateQty(item.row_name, item.qty + 1).catch(() => setQuantity(String(item.qty))); }} aria-label={`Increase ${item.item_name}`}>
							<Plus className="size-4" />
						</button>
					</div>
					<div className="text-right">
						<p className="text-xs text-on-surface-variant">{item.qty} × {formatCurrency(item.rate, currency)}</p>
						<p className="text-sm font-semibold text-on-surface">{formatCurrency(item.amount, currency)}</p>
					</div>
				</div>
			</div>

			{expanded && !item.is_free_item ? (
				<div id={`cart-item-details-${item.row_name}`} className="space-y-4 border-t border-primary bg-surface-container-low p-4">
					{description ? <p className="rounded-md bg-surface px-3 py-2 text-xs leading-5 text-on-surface-variant">{description}</p> : null}

					<PricingEditor
						key={`${item.uom}-${item.rate}-${item.discount_percentage || 0}-${item.discount_amount || 0}`}
						allowDiscountChange={Boolean(allowDiscountChange)}
						allowRateChange={Boolean(allowRateChange)}
						currency={currency}
						disabled={itemDisabled}
						item={item}
						onUpdate={(override) => onUpdatePricing(item.row_name, override)}
					/>
					{item.pricing_override ? <div className="mt-3 rounded-md border border-tertiary bg-tertiary-container px-3 py-2 text-xs text-on-tertiary-container"><span className="font-semibold">Manual price override:</span> {pricingOverrideLabel(item.pricing_override, currency)}{item.pricing_override_by ? ` · ${item.pricing_override_by}` : " · current cashier"}</div> : item.pricing_rules ? <div className="mt-3 rounded-md bg-secondary-container px-3 py-2 text-xs text-on-secondary-container">Promotion or pricing rule applied: {item.pricing_rules}</div> : null}

					<label className="flex items-center justify-between gap-5 rounded-md border border-outline-variant bg-surface p-3">
						<span className="shrink-0 text-xs font-medium text-on-surface-variant">UOM</span>
						<select className="h-[34px] min-w-0 flex-1 rounded-md border border-outline-variant bg-surface px-2 text-[13px]" disabled={disabled || (item.uoms?.length || 0) < 2} value={item.uom || item.stock_uom || ""} onChange={(event) => { const selected = item.uoms?.find((row) => row.uom === event.target.value); if (selected) void onUpdateUom(item.row_name, selected.uom, selected.conversion_factor); }}>{(item.uoms?.length ? item.uoms : [{ uom: item.uom || item.stock_uom || "", conversion_factor: 1 }]).map((row) => <option key={row.uom} value={row.uom}>{row.uom} ({row.conversion_factor} {item.stock_uom})</option>)}</select>
					</label>

					<ItemNoteEditor key={item.item_note || "empty-note"} disabled={Boolean(disabled)} item={item} onSave={(note) => onUpdateNote(item.row_name, note)} />

					{isSerialTracked ? <div className="overflow-hidden rounded-md border border-outline-variant bg-surface"><button type="button" className="flex w-full items-center justify-between p-3 text-left hover:bg-surface-container" onClick={() => setSerialExpanded((value) => !value)}><span><span className="block text-xs font-medium uppercase tracking-wide text-on-surface-variant">Serial numbers</span><span className="text-xs text-on-surface-variant">{item.serial_allocations?.length || 0} of {item.qty * Number(item.conversion_factor || 1)} selected</span></span><ChevronDown className={`size-4 transition-transform ${serialExpanded ? "rotate-180" : ""}`} /></button>{serialExpanded ? <SerialAllocationEditor data={batchData} disabled={Boolean(disabled)} item={item} onSave={(rows) => onUpdateSerialAllocations(item.row_name, rows)} /> : null}</div> : null}
					{isBatchTracked && !isSerialTracked ? (
						<div className="overflow-hidden rounded-md border border-outline-variant bg-surface">
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
	const [expanded, setExpanded] = useState(false);
	const save = async () => {
		if (note.trim() === (item.item_note || "")) return;
		try { setError(null); await onSave(note); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Failed to save item note"); }
	};
	return <div className="overflow-hidden rounded-md border border-outline-variant bg-surface"><button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface-container" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}><span><span className="block text-xs font-medium uppercase tracking-wide text-on-surface-variant">Item note</span><span className="mt-1 block max-w-72 truncate text-xs text-on-surface-variant">{note.trim() || "No note added"}</span></span><ChevronDown className={`size-4 shrink-0 text-on-surface-variant transition-transform ${expanded ? "rotate-180" : ""}`} /></button>{expanded ? <label className="block border-t border-outline-variant p-3"><textarea className="min-h-20 w-full resize-y rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary" disabled={disabled} maxLength={500} placeholder="Add packing, handling, or cashier notes…" value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur(); }} /><span className="mt-1 flex justify-between text-xs text-on-surface-variant"><span>{error ? <span className="text-error">{error}</span> : "Ctrl/⌘ + Enter to save"}</span><span>{note.length}/500</span></span></label> : null}</div>;
}

function SerialAllocationEditor({ data, disabled, item, onSave }: { data: ItemBatchesDTO | null; disabled: boolean; item: InvoiceItemDTO; onSave: (rows: SerialAllocationDTO[]) => Promise<void> }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(() => new Set((item.serial_allocations || []).map((row) => row.serial_no)));
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const required = item.qty * Number(item.conversion_factor || 1);
	const serials = data?.serials || [];
	const filtered = serials.filter((row) => row.serial_no.toLowerCase().includes(query.toLowerCase()));
	const persist = (next: Set<string>) => {
		if (next.size !== required || !Number.isInteger(required)) return;
		setSaving(true);
		setSaveError(null);
		void onSave(serials.filter((row) => next.has(row.serial_no)))
			.catch((error: unknown) => setSaveError(error instanceof Error ? error.message : "Failed to save serial numbers"))
			.finally(() => setSaving(false));
	};
	const toggle = (serialNo: string) => {
		const next = new Set(selected);
		if (next.has(serialNo)) next.delete(serialNo);
		else if (next.size < required) next.add(serialNo);
		setSelected(next);
		persist(next);
	};
	const scan = () => { const exact = serials.find((row) => row.serial_no.toLowerCase() === query.trim().toLowerCase()); if (exact) { toggle(exact.serial_no); setQuery(""); } };
	return <div className="border-t border-outline-variant p-3"><div className="flex gap-2"><input className="h-9 min-w-0 flex-1 rounded-md border border-outline-variant bg-surface px-2 text-sm" placeholder="Scan or search serial number" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); scan(); } }} /><Button size="sm" variant="ghost" onClick={scan}>Add scan</Button></div><div className="mt-3 max-h-56 space-y-2 overflow-y-auto">{filtered.map((row) => <label key={row.serial_no} className="flex items-center gap-2 rounded-md border border-outline-variant bg-surface p-2 text-sm"><input type="checkbox" checked={selected.has(row.serial_no)} disabled={disabled || saving || (!selected.has(row.serial_no) && selected.size >= required)} onChange={() => toggle(row.serial_no)} /><span className="min-w-0 flex-1 truncate">{row.serial_no}</span>{row.batch_no ? <span className="text-xs text-on-surface-variant">{row.batch_no}</span> : null}</label>)}</div><div className="mt-3 flex items-center justify-between"><span className={selected.size === required ? "text-xs text-on-surface-variant" : "text-xs text-error"}>Selected {selected.size} / {required}</span><span className="text-xs text-on-surface-variant">{saving ? "Saving…" : selected.size === required ? "Saved automatically" : "Select the required serials"}</span></div>{saveError ? <p className="mt-2 text-xs text-error">{saveError}</p> : null}</div>;
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
	const taxRate = Number(item.item_tax?.tax_rate || 0);
	const inclusiveTaxRate = Number(item.item_tax?.inclusive_tax_rate || 0);
	const exclusiveTaxRate = Number(item.item_tax?.exclusive_tax_rate || 0);
	const taxInclusive = inclusiveTaxRate > 0;
	const mixedTaxTreatment = inclusiveTaxRate > 0 && exclusiveTaxRate > 0;
	const numericRate = Number(rate || 0);
	const baseRate = taxInclusive ? numericRate / (1 + inclusiveTaxRate / 100) : numericRate;
	const inclusiveRate = baseRate * (1 + taxRate / 100);
	const taxPerUnit = inclusiveRate - baseRate;

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
		<div className="rounded-md border border-outline-variant bg-surface p-3">
			<div className={taxRate > 0 ? "grid grid-cols-2 gap-3" : ""}>
				<PriceInput label={mixedTaxTreatment ? "Selling rate (partly incl. tax)" : taxInclusive ? "Selling rate (incl. tax)" : taxRate > 0 ? "Selling rate (excl. tax)" : "Selling rate"} value={rate} readOnly={!allowRateChange || disabled} onChange={setRate} onApply={() => apply("rate", rate)} onReset={item.pricing_override ? () => void reset() : undefined} resetDisabled={disabled || saving} />
				{taxRate > 0 ? <ReadOnlyPrice label={mixedTaxTreatment || !taxInclusive ? "Rate (incl. tax)" : "Base rate"} value={mixedTaxTreatment || !taxInclusive ? inclusiveRate : baseRate} currency={currency} /> : null}
			</div>
			{taxRate > 0 ? <div className="mt-3 grid grid-cols-2 gap-3"><ReadOnlyValue label="Tax rate" value={`${taxRate}%`} /><ReadOnlyPrice label="Tax per unit" value={taxPerUnit} currency={currency} /></div> : null}
			<div className="mt-3 grid grid-cols-2 gap-3">
				<PriceInput label="Discount %" value={discountPercentage} readOnly={!allowDiscountChange || disabled} max={100} onChange={changeDiscountPercentage} onApply={() => apply("discount_percentage", discountPercentage)} />
				<PriceInput label="Discount amount" value={discountAmount} readOnly={!allowDiscountChange || disabled} onChange={changeDiscountAmount} onApply={() => apply("discount_amount", discountAmount)} />
			</div>
			{error ? <p className="mt-2 text-xs text-error">{error}</p> : null}
		</div>
	);
}

function ReadOnlyPrice({ currency, label, value }: { currency?: string; label: string; value: number }) {
	return <ReadOnlyValue label={label} value={formatCurrency(value, currency)} />;
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
	return <div><span className="text-xs text-on-surface-variant">{label}</span><div className="mt-1 flex h-[34px] items-center justify-end rounded-md border border-outline-variant bg-surface-container px-2 text-[13px] text-on-surface-variant">{value}</div></div>;
}

function PriceInput({ label, max, onApply, onChange, onReset, readOnly, resetDisabled, value }: { label: string; max?: number; onApply: () => void; onChange: (value: string) => void; onReset?: () => void; readOnly?: boolean; resetDisabled?: boolean; value: string }) {
	return <div><div className="flex items-center justify-between gap-2"><span className="text-xs text-on-surface-variant">{label}</span>{onReset ? <button type="button" className="text-xs font-medium text-primary hover:underline disabled:opacity-50" disabled={resetDisabled} onClick={onReset}>Reset</button> : null}</div><input aria-label={label} className={`mt-1 h-[34px] w-full rounded-md border border-outline-variant px-2 text-right text-[13px] outline-none ${readOnly ? "bg-surface-container text-on-surface-variant" : "bg-surface focus:border-primary"}`} readOnly={readOnly} inputMode="decimal" min="0" max={max} step="any" type="number" value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => { if (!readOnly && value !== "") onApply(); }} onKeyDown={(event) => { if (event.key === "Enter" && !readOnly) event.currentTarget.blur(); }} /></div>;
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
					{batchData?.verified_at ? <p className="mt-1 text-xs text-on-surface-variant">Verified {new Date(batchData.verified_at).toLocaleString()}</p> : null}
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
