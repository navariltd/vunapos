import { Button } from "../../../components/ui/Button";
import { formatCurrency } from "../../pos/utils";
import type { OrderPreviewDTO } from "../types";
import { Sheet } from "./Sheet";

type BillPreviewDialogProps = {
  preview: OrderPreviewDTO | null;
  currency?: string;
  onClose: () => void;
};

// The bill as checkout will price it (service type price list, offers, service
// charge and taxes), from preview_order. Needs no shift; nothing is saved.
export function BillPreviewDialog({ preview, currency, onClose }: BillPreviewDialogProps) {
  const invoice = preview?.invoice;
  const totals = invoice?.totals ?? {};
  const grand = totals.grand_total ?? 0;
  const rounded = totals.rounded_total;
  const showRounded = rounded !== undefined && rounded !== null && Math.abs(rounded - grand) > 0.0001;

  return (
    <Sheet
      isOpen={Boolean(preview)}
      title="Bill"
      description={preview ? `${preview.order.name}${preview.order.table_label ? ` · Table ${preview.order.table_label}` : ""}` : undefined}
      onClose={onClose}
      footer={
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Close
        </Button>
      }
    >
      {invoice ? (
        <div className="space-y-4 text-sm">
          <ul className="space-y-1">
            {invoice.items.map((item) => (
              <li key={item.row_name} className="flex justify-between gap-3">
                <span className="min-w-0 text-on-surface">
                  {item.qty} × {item.item_name}
                </span>
                <span className="shrink-0 tabular-nums text-on-surface">{formatCurrency(item.amount, currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-outline-variant pt-3">
            <div className="flex justify-between">
              <dt className="text-on-surface-variant">Subtotal</dt>
              <dd className="tabular-nums">{formatCurrency(totals.net_total, currency)}</dd>
            </div>
            {(invoice.taxes ?? []).map((tax, index) => (
              <div key={`${tax.description}-${index}`} className="flex justify-between">
                <dt className="text-on-surface-variant">{tax.description}</dt>
                <dd className="tabular-nums">{formatCurrency(tax.tax_amount, currency)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-outline-variant pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCurrency(showRounded ? rounded : grand, currency)}</dd>
            </div>
            {showRounded ? (
              <p className="text-right text-xs text-on-surface-variant">Before rounding {formatCurrency(grand, currency)}</p>
            ) : null}
          </dl>
        </div>
      ) : null}
    </Sheet>
  );
}
