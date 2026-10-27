import { memo } from "react";
import { Plus } from "lucide-react";

import { cn } from "../../../lib/cn";
import { ItemTaxPrice } from "../../pos/components/ItemTaxPrice";
import type { ItemDTO } from "../../pos/types";

type MenuListRowProps = {
  item: ItemDTO;
  // How many are already on the order, sent and waiting.
  qty: number;
  currency?: string;
  onAdd: (item: ItemDTO) => void;
};

// The phone menu: one compact row per item, the whole row adds one.
export const MenuListRow = memo(function MenuListRow({ item, qty, currency, onAdd }: MenuListRowProps) {
  return (
    <li>
      <button
        type="button"
        className="flex min-h-16 w-full items-center gap-3 px-1 py-2 text-left hover:bg-surface-container-low"
        aria-label={qty ? `Add ${item.item_name}, ${qty} on the order` : `Add ${item.item_name}`}
        onClick={() => onAdd(item)}
      >
        {item.image ? (
          <img src={item.image} alt="" className="size-11 shrink-0 rounded-md bg-surface-container object-cover" />
        ) : null}
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium text-on-surface">{item.item_name}</span>
        <span className="shrink-0">
          <ItemTaxPrice currency={currency} item={item} align="right" />
        </span>
        <span
          className={cn(
            "flex h-10 min-w-10 shrink-0 items-center justify-center gap-0.5 rounded-full px-2 text-sm font-semibold tabular-nums",
            qty ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface",
          )}
          aria-hidden="true"
        >
          <Plus className="size-4" />
          {qty ? qty : null}
        </span>
      </button>
    </li>
  );
});
