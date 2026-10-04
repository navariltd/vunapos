import { Pencil, ShoppingCart } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { navigateToInvoice } from "../../../lib/stores/navigationStore";
import type { HeldInvoiceDTO } from "../types";
import { formatCurrency } from "../utils";

type HeldInvoicesPanelProps = {
  currency?: string;
  heldInvoices?: HeldInvoiceDTO[];
  isLoading?: boolean;
  onEdit: (invoice: HeldInvoiceDTO) => void;
  onCheckout: (invoice: HeldInvoiceDTO) => void;
};

function formatModified(value?: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export function HeldInvoicesPanel({
  currency,
  heldInvoices,
  isLoading,
  onEdit,
  onCheckout,
}: HeldInvoicesPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <p className="py-10 text-center text-sm text-on-surface-variant">
          Loading draft invoices...
        </p>
      ) : heldInvoices?.length ? (
        <div className="overflow-x-auto rounded-lg border border-outline-variant">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th>Customer</th>
                <th>Held at</th>
                <th>Total</th>
                <th className="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {heldInvoices.map((invoice) => (
                <tr
                  key={`${invoice.doctype}-${invoice.name}`}
                  className="border-t border-outline-variant"
                >
                  <td className="px-4 py-3">
                    <a
                      className="font-medium text-primary hover:underline"
                      href={`/vunapos/invoices/${encodeURIComponent(invoice.name)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigateToInvoice(invoice.name);
                      }}
                    >
                      {invoice.name}
                    </a>
                    <span className="block text-xs text-on-surface-variant">
                      {invoice.doctype}
                    </span>
                  </td>
                  <td>
                    {invoice.customer_name || invoice.customer || "No customer"}
                    {invoice.customer_name && invoice.customer ? (
                      <span className="block text-xs text-on-surface-variant">
                        {invoice.customer}
                      </span>
                    ) : null}
                  </td>
                  <td>{formatModified(invoice.modified || invoice.posting_date) || "-"}</td>
                  <td className="font-medium">
                    {formatCurrency(invoice.total ?? invoice.rounded_total ?? invoice.grand_total, invoice.currency || currency)}
                  </td>
                  <td className="px-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(invoice)}>
                        <Pencil className="mr-1 size-4" />
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => onCheckout(invoice)}>
                        <ShoppingCart className="mr-1 size-4" />
                        Checkout
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-outline-variant p-10 text-center">
          <p className="font-medium">No draft invoices</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            Draft invoices will appear here until they are restored.
          </p>
        </div>
      )}
    </div>
  );
}
