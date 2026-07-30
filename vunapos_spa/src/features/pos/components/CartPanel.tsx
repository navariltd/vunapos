import { useState } from "react";
import { Pause, Trash2 } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/cn";
import { getActiveCustomer, useCartStore } from "../stores/cartStore";
import type { BatchAllocationDTO, CustomerDTO, CustomerLoyaltyDTO, ItemBatchesDTO, PricingOverrideDTO, SerialAllocationDTO } from "../types";
import { formatCurrency, getInvoiceTotal } from "../utils";
import { CartItemRow } from "./CartItemRow";
import { CustomerSelector } from "./CustomerSelector";
import { CustomerLoyaltyCard } from "./CustomerLoyaltyCard";

type CartPanelProps = {
	allowPriceListSwitching?: boolean;
	allowedPriceLists?: Array<{ name: string; currency?: string }>;
	allowDiscountChange?: boolean;
	allowRateChange?: boolean;
	className?: string;
	currency?: string;
	customerLoyalty?: CustomerLoyaltyDTO | null;
	customerLoyaltyError?: string | null;
	isCustomerLoyaltyLoading?: boolean;
	defaultPriceList?: string;
	onCheckout: () => void;
	onClearCustomer: () => void;
	onClearCart: () => void;
	onHold: () => void;
	onLoadBatches: (itemCode: string, warehouse: string, isOnline: boolean) => Promise<ItemBatchesDTO>;
	onRemoveItem: (rowName: string) => void;
	onSelectCustomer: (customer: CustomerDTO) => void;
	onSelectPriceList: (priceList?: string) => void;
	onUpdateQty: (rowName: string, qty: number) => Promise<void>;
	onUpdatePricing: (rowName: string, pricingOverride?: PricingOverrideDTO) => Promise<void>;
	onUpdateNote: (rowName: string, note: string) => Promise<void>;
	onUpdateBatchAllocations: (rowName: string, allocations: BatchAllocationDTO[]) => Promise<void>;
	onUpdateUom: (rowName: string, uom: string, conversionFactor: number) => Promise<void>;
	onUpdateSerialAllocations: (rowName: string, allocations: SerialAllocationDTO[]) => Promise<void>;
	isOnline: boolean;
	warehouse?: string;
	selectedPriceList?: string;
};

export function CartPanel({
	allowDiscountChange,
	allowRateChange,
	allowPriceListSwitching,
	allowedPriceLists = [],
	className,
	currency,
	customerLoyalty,
	customerLoyaltyError,
	isCustomerLoyaltyLoading,
	defaultPriceList,
	onCheckout,
	onClearCustomer,
	onClearCart,
	onHold,
	onLoadBatches,
	onRemoveItem,
	onSelectCustomer,
	onSelectPriceList,
	onUpdateQty,
	onUpdatePricing,
	onUpdateNote,
	onUpdateBatchAllocations,
	onUpdateUom,
	onUpdateSerialAllocations,
	isOnline,
	warehouse,
	selectedPriceList,
}: CartPanelProps) {
	const invoice = useCartStore((s) => s.invoice);
	const isMutating = useCartStore((s) => s.isMutating);
	const selectedCustomer = useCartStore(getActiveCustomer);
	const items = invoice?.items || [];
	const total = getInvoiceTotal(invoice);
	const taxes = invoice?.taxes || [];
	const grandTotal = Number(invoice?.totals?.grand_total || 0);
	const roundedTotal = Number(invoice?.totals?.rounded_total || 0);
	const showRoundedTotal = Boolean(roundedTotal && Math.abs(roundedTotal - grandTotal) > 0.0001);
	const [expandedRow, setExpandedRow] = useState<string | null>(null);

	return (
		<aside className={cn("flex min-h-0 flex-col border-t border-outline-variant bg-surface p-4 xl:border-l xl:border-t-0", className)}>
			<div className="shrink-0">
				<CustomerSelector
					selectedCustomer={selectedCustomer}
					onClear={onClearCustomer}
					onSelect={onSelectCustomer}
				/>
				<CustomerLoyaltyCard
					currency={currency}
					data={customerLoyalty}
					error={customerLoyaltyError}
					isLoading={isCustomerLoyaltyLoading}
				/>
				{allowPriceListSwitching && allowedPriceLists.length ? (
					<select
						aria-label="Price list for this sale"
						className="mt-2 h-10 w-full rounded-md border border-outline-variant bg-surface px-3 text-sm text-on-surface outline-none focus:border-primary"
						disabled={isMutating}
						value={selectedPriceList || defaultPriceList || ""}
						onChange={(event) => onSelectPriceList(
							event.target.value === defaultPriceList ? undefined : event.target.value || undefined,
						)}
					>
						{defaultPriceList ? <option value={defaultPriceList}>{defaultPriceList} (Default)</option> : null}
						{allowedPriceLists.filter((priceList) => priceList.name !== defaultPriceList).map((priceList) => (
							<option key={priceList.name} value={priceList.name}>{priceList.name}</option>
						))}
					</select>
				) : null}
			</div>

			<div className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
				{items?.length ? (
					items?.map((item, index) => {
						const rowIdentity = `${item.row_name}-${item.uom || item.stock_uom || ""}-${Number(item.conversion_factor || 1)}-${index}`;
						return (
						<CartItemRow
							key={rowIdentity}
							currency={currency}
							allowDiscountChange={allowDiscountChange}
							allowRateChange={allowRateChange}
							disabled={isMutating}
							expanded={expandedRow === rowIdentity}
							isOnline={isOnline}
							item={item}
							onLoadBatches={onLoadBatches}
							onRemove={onRemoveItem}
							onToggle={() =>
								setExpandedRow((current) => (current === rowIdentity ? null : rowIdentity))
							}
							onUpdateQty={onUpdateQty}
							onUpdatePricing={onUpdatePricing}
							onUpdateNote={onUpdateNote}
							onUpdateBatchAllocations={onUpdateBatchAllocations}
							onUpdateUom={onUpdateUom}
							onUpdateSerialAllocations={onUpdateSerialAllocations}
							warehouse={warehouse}
						/>
						);
					})
				) : (
					<div className="rounded-md border border-dashed border-outline-variant bg-surface-container-low p-6 text-center">
						<p className="text-sm font-medium text-on-surface">Cart is empty</p>
						<p className="mt-1 text-xs text-on-surface-variant">Select an item to start a sale.</p>
					</div>
				)}
			</div>

			<div className="mt-4 shrink-0 border-t border-outline-variant bg-surface pt-4">
				<div className="space-y-1.5 text-xs">
					<div className="flex justify-between">
						<span className="text-on-surface-variant">Subtotal</span>
						<span className="font-medium">{formatCurrency(invoice?.totals?.net_total, currency)}</span>
					</div>
					{taxes.map((tax, index) => (
						<div
							key={`${tax.account_head || tax.description || "tax"}-${index}`}
							className="flex items-start justify-between gap-3 text-[11px]"
						>
							<span className="min-w-0 text-on-surface-variant">
								<span className="truncate">{tax.description || tax.account_head || "Tax"}</span>
								<span className="ml-1">
									{tax.rate ? `${tax.rate}% · ` : ""}
									{tax.included_in_print_rate ? "Included" : "Added"}
								</span>
							</span>
							<span className="shrink-0 font-medium text-on-surface">
								{formatCurrency(tax.tax_amount, currency)}
							</span>
						</div>
					))}
					<div className="flex justify-between">
						<span className="text-on-surface-variant">Total taxes and charges</span>
						<span className="font-medium">{formatCurrency(invoice?.totals?.total_taxes_and_charges, currency)}</span>
					</div>
					<div className="flex justify-between text-sm">
						<span className="font-semibold text-on-surface">Grand total</span>
						<span className="font-semibold text-on-surface">{formatCurrency(invoice?.totals?.grand_total, currency)}</span>
					</div>
					{showRoundedTotal ? (
						<div className="flex justify-between text-sm">
							<span className="font-semibold text-on-surface">Rounded total</span>
							<span className="font-semibold text-on-surface">{formatCurrency(total, currency)}</span>
						</div>
					) : null}
				</div>

				<div className="mt-5 grid grid-cols-2 gap-2">
					<Button
						variant="ghost"
						className="gap-2 bg-tertiary text-on-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container"
						disabled={isMutating || !items.length}
						onClick={onHold}
					>
						<Pause className="size-4" />
						Hold
					</Button>
					<Button
						variant="danger"
						className="gap-2"
						disabled={isMutating || !items.length}
						onClick={onClearCart}
					>
						<Trash2 className="size-4" />
						Clear Cart
					</Button>
					<div className="col-span-2">
						<Button className="w-full" disabled={isMutating || !items?.length || invoice?.docstatus !== 0} onClick={onCheckout}>
							{invoice?.is_local ? "Checkout" : "Continue Checkout"}
						</Button>
					</div>
				</div>
			</div>
		</aside>
	);
}
