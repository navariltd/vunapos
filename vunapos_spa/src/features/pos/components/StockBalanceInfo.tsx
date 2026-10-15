import { Info } from "lucide-react";

import type { ItemDTO } from "../types";
import { formatStockBalanceTooltip } from "../utils";

type StockBalanceInfoProps = {
  item: Pick<ItemDTO, "actual_qty" | "stock_uom" | "sales_uom" | "uom" | "conversion_factor">;
};

export function StockBalanceInfo({ item }: StockBalanceInfoProps) {
  const message = formatStockBalanceTooltip(item);
  if (!message) return null;

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="View stock balance details"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-56 -translate-x-1/2 rounded-md bg-neutral-900 px-2.5 py-2 text-left text-xs font-medium leading-4 text-white shadow-lg group-hover:block group-focus-within:block dark:bg-neutral-100 dark:text-neutral-900"
      >
        {message}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-900 dark:border-t-neutral-100" />
      </span>
    </span>
  );
}
