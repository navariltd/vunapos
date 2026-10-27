import { Plus } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { elapsedLabel } from "../tableStatus";
import type { TableOrderRefDTO } from "../types";
import { Sheet } from "./Sheet";

type TableOrdersSheetProps = {
  tableLabel: string | null;
  orders: TableOrderRefDTO[];
  now: Date;
  onOpenOrder: (order: string) => void;
  onNewOrder: () => void;
  onClose: () => void;
};

// For profiles that allow several open orders on one table.
export function TableOrdersSheet({ tableLabel, orders, now, onOpenOrder, onNewOrder, onClose }: TableOrdersSheetProps) {
  return (
    <Sheet
      isOpen={tableLabel !== null}
      title={`Table ${tableLabel ?? ""}`}
      description={`${orders.length} open ${orders.length === 1 ? "order" : "orders"}`}
      onClose={onClose}
      footer={
        <Button className="w-full gap-2" onClick={onNewOrder}>
          <Plus className="size-4" aria-hidden="true" />
          New order on this table
        </Button>
      }
    >
      <ul className="space-y-2">
        {orders.map((order) => (
          <li key={order.name}>
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-outline-variant px-3 py-2 text-left hover:bg-surface-container"
              onClick={() => onOpenOrder(order.name)}
            >
              <span className="min-w-0">
                <span className="block font-medium text-on-surface">{order.name}</span>
                <span className="block truncate text-xs text-on-surface-variant">
                  {[order.pax ? `${order.pax} guests` : null, order.waiter_name || order.waiter].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-xs text-on-surface-variant">{elapsedLabel(order.opened_at, now)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
