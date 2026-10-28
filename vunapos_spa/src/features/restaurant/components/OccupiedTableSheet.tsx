import { Button } from "../../../components/ui/Button";
import { elapsedLabel } from "../tableStatus";
import type { TableOrderRefDTO } from "../types";
import { Sheet } from "./Sheet";

type OccupiedTableSheetProps = {
  tableLabel: string | null;
  orders: TableOrderRefDTO[];
  now: Date;
  // The profile allows several open orders on one table.
  allowSeparate: boolean;
  busy: boolean;
  onAddToOrder: (order: string) => void;
  onStartSeparate: () => void;
  onClose: () => void;
};

const itemsLabel = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

// Picking an occupied table: add the lines to its open order, start a separate
// order there (when the profile allows it) or choose another table.
export function OccupiedTableSheet({
  tableLabel,
  orders,
  now,
  allowSeparate,
  busy,
  onAddToOrder,
  onStartSeparate,
  onClose,
}: OccupiedTableSheetProps) {
  const single = orders.length === 1 ? orders[0] : null;
  return (
    <Sheet
      isOpen={Boolean(tableLabel)}
      title={
        single
          ? `${tableLabel} already has an open order`
          : `${tableLabel} already has ${orders.length} open orders`
      }
      description="Add these items to an open order, or choose another table."
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Choose another table
          </Button>
          {allowSeparate ? (
            <Button variant="ghost" className="h-11" disabled={busy} onClick={onStartSeparate}>
              Start a separate order
            </Button>
          ) : null}
          {single ? (
            <Button className="h-11" disabled={busy} onClick={() => onAddToOrder(single.name)}>
              {busy ? "Adding…" : "Add to this order"}
            </Button>
          ) : null}
        </div>
      }
    >
      <ul className="space-y-2">
        {orders.map((order) => (
          <li
            key={order.name}
            className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-outline-variant px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-on-surface">{order.name}</span>
              <span className="block truncate text-xs text-on-surface-variant">
                {[order.waiter_name || order.waiter, itemsLabel(order.item_count ?? 0), elapsedLabel(order.opened_at, now)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {single ? null : (
              <Button size="sm" className="h-9 shrink-0" disabled={busy} onClick={() => onAddToOrder(order.name)}>
                Add to this order
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
