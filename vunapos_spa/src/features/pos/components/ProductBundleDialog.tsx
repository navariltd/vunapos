import { X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { ItemDTO } from "../types";
import { formatCurrency } from "../utils";

export type ProductBundleDetails = {
  item_code: string;
  price_list?: string;
  warehouse?: string;
  available_qty?: number | null;
  items: NonNullable<ItemDTO["bundle_items"]>;
};

type ProductBundleDialogProps = {
  currency?: string;
  error?: string | null;
  isLoading?: boolean;
  isOpen: boolean;
  bundle: ItemDTO | null;
  details: ProductBundleDetails | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function ProductBundleDialog({
  currency,
  error,
  isLoading,
  isOpen,
  bundle,
  details,
  onClose,
  onConfirm,
}: ProductBundleDialogProps) {
  if (!isOpen || !bundle) return null;
  const availableQty = Number(details?.available_qty ?? bundle.actual_qty ?? 0);
  const canAdd =
    Boolean(details) &&
    (availableQty > 0 || Boolean(bundle.allow_negative_stock));

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bundle-dialog-title"
      >
        <header className="flex items-start gap-3 border-b border-outline-variant p-5">
          <div className="min-w-0 flex-1">
            <h2 id="bundle-dialog-title" className="text-lg font-semibold text-on-surface">
              {bundle.item_name || bundle.item_code}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Review the components included in this product bundle.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
            onClick={onClose}
            aria-label="Close product bundle details"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-on-surface-variant">
              Loading bundle components…
            </p>
          ) : error ? (
            <p className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
              {error}
            </p>
          ) : details ? (
            <>
              <div className="mb-4 flex items-center justify-between rounded-lg bg-surface-container-low p-3 text-sm">
                <span className="text-on-surface-variant">Available bundles</span>
                <strong className={availableQty > 0 ? "text-on-surface" : "text-error"}>
                  {availableQty > 0 ? availableQty : "Out of stock"}
                </strong>
              </div>
              <div className="space-y-2">
                {details.items.map((component) => (
                  <div
                    key={component.item_code}
                    className="flex items-center gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-on-surface">
                        {component.item_name || component.item_code}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {component.item_code} · Required {component.qty} {component.uom || "units"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-on-surface-variant">
                      <p>
                        {component.available_qty == null
                          ? "Availability checked at checkout"
                          : `${component.available_qty} available`}
                      </p>
                      {component.has_batch_no || component.has_serial_no ? (
                        <p className="mt-1 text-primary">
                          {component.has_serial_no ? "Serial tracked" : "Batch tracked"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-on-surface-variant">
                Bundle price: {formatCurrency(Number(bundle.rate || 0), currency)}. Component stock is revalidated by ERPNext when the sale is submitted.
              </p>
            </>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-outline-variant p-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!canAdd} onClick={onConfirm}>Add Bundle</Button>
        </footer>
      </div>
    </div>
  );
}
