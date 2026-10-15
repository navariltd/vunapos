import { memo } from "react";
import { Info, Loader2, Plus } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { ItemDTO } from "../types";
import { formatAvailableStock, formatStockBalanceTooltip } from "../utils";
import { ItemTaxLabel, ItemTaxPrice } from "./ItemTaxPrice";

type ItemListRowProps = {
  currency?: string;
  disabled?: boolean;
  ignoreStock?: boolean;
  pending?: boolean;
  item: ItemDTO;
  onAdd: (item: ItemDTO) => void;
};

export const ItemListRow = memo(function ItemListRow({
  currency,
  disabled,
  ignoreStock,
  item,
  onAdd,
  pending,
}: ItemListRowProps) {
  const outOfStock =
    !item.has_variants &&
    !item.is_product_bundle &&
    Boolean(item.is_stock_item ?? true) &&
    !item.allow_negative_stock &&
    item.actual_qty !== undefined &&
    Number(item.actual_qty || 0) <= 0;
  const isDisabled = disabled || (outOfStock && !ignoreStock);

  return (
    <div
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-3 py-3 transition-colors hover:bg-surface-container sm:grid-cols-[minmax(0,1fr)_12rem_8rem_5rem] sm:px-4 md:grid-cols-[20rem_12rem_minmax(7rem,1fr)_5rem] ${pending ? "border-primary bg-primary/5" : "border-outline-variant"}`}
      onClick={() => {
        if (!isDisabled) onAdd(item);
      }}
    >
      <button
        type="button"
        className="min-w-0 cursor-pointer text-left disabled:cursor-not-allowed"
        disabled={isDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onAdd(item);
        }}
      >
        <span className="block truncate text-sm font-semibold text-on-surface">
          {item.item_name}
        </span>
        {item.is_product_bundle ? (
          <span className="mt-1 inline-flex rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-secondary-container">
            Bundle
          </span>
        ) : null}
        <span className="block truncate text-xs text-on-surface-variant">
          {[item.item_code, item.item_group, item.stock_uom]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <ItemTaxLabel item={item} reserveSpace />
      </button>
      <div className="text-right sm:order-none sm:text-left">
        <ItemTaxPrice currency={currency} item={item} align="right" />
        <div
          className={
            outOfStock
              ? "flex items-center justify-end gap-1 text-xs font-medium text-error sm:hidden"
              : "flex items-center justify-end gap-1 text-xs text-on-surface-variant sm:hidden"
          }
        >
          <span>{outOfStock ? "Out of stock" : item.actual_qty === undefined ? "" : formatAvailableStock(item)}</span>
          {item.actual_qty !== undefined ? <span className="shrink-0 cursor-help" aria-label={formatStockBalanceTooltip(item)} title={formatStockBalanceTooltip(item)}><Info className="size-3.5" aria-hidden="true" /></span> : null}
        </div>
      </div>
      <div
        className={
          outOfStock
            ? "hidden items-center gap-1 pl-6 text-left text-sm font-medium text-error sm:flex"
            : "hidden items-center gap-1 pl-6 text-left text-sm text-on-surface-variant sm:flex"
        }
      >
        <span>{outOfStock ? "Out of stock" : item.actual_qty === undefined ? "—" : formatAvailableStock(item)}</span>
        {item.actual_qty !== undefined ? <span className="shrink-0 cursor-help" aria-label={formatStockBalanceTooltip(item)} title={formatStockBalanceTooltip(item)}><Info className="size-3.5" aria-hidden="true" /></span> : null}
      </div>
      <Button
        size="sm"
        className={`flex size-9 shrink-0 gap-1 p-0 sm:h-9 sm:w-auto sm:px-2 ${pending ? "bg-primary-container text-on-primary-container" : ""}`}
        disabled={isDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onAdd(item);
        }}
        aria-label={`Add ${item.item_name}`}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{" "}
        <span className="hidden sm:inline">{pending ? "Adding" : "Add"}</span>
      </Button>
    </div>
  );
});
