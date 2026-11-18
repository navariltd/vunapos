import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { stockQty } from "./stockFormatting";
import { newRequestDraft } from "./requestDraft";
import {
  initialReceiptSelection,
  receiptLineState,
  type AcceptedQuantity,
  type ReceiptSelection,
} from "./receiving";
import type { StockEntryDetails } from "./types";

export function ReceiveStockDialog({
  transfer,
  busy,
  online,
  error,
  onClose,
  onReceive,
}: {
  transfer: StockEntryDetails;
  busy: boolean;
  online: boolean;
  error: string;
  onClose: () => void;
  onReceive: (quantities: AcceptedQuantity[], key: string) => void;
}) {
  const rows = transfer.items.filter((row) => row.remaining_qty > 0);
  const [selection, setSelection] = useState(() =>
    initialReceiptSelection(rows)
  );
  const [key] = useState(() => newRequestDraft().key);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const states = rows.map((row) => receiptLineState(row, selection[row.name]));
  const accepted = states.filter((row) => row.stock > 0).length;
  const partial = states.some((row) => row.left > 0);
  const invalid = !accepted || states.some((row) => row.error);
  const update = (name: string, change: Partial<ReceiptSelection[string]>) =>
    setSelection((current) => ({
      ...current,
      [name]: { ...current[name], ...change },
    }));
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-2 sm:p-4">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receive-stock-title"
        className="flex h-[calc(100dvh-1rem)] max-h-[48rem] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-xl sm:h-[calc(100dvh-2rem)]"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled)"
            );
            if (!controls?.length) {
              event.preventDefault();
              return;
            }
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant p-4 sm:p-5">
          <div>
            <h2 id="receive-stock-title" className="text-lg font-semibold">
              Receive stock
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {transfer.name} → {transfer.warehouse}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close receiving form"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-2 hover:bg-surface-container"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-on-surface-variant">
              Enter accepted quantities. Use 0 for items not received; the
              remainder stays in transit.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setSelection(initialReceiptSelection(rows))}
              >
                Accept all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setSelection((current) =>
                    Object.fromEntries(
                      Object.entries(current).map(([id, value]) => [
                        id,
                        {
                          ...value,
                          qty: "0",
                          allocations: value.allocations ? [] : undefined,
                        },
                      ])
                    )
                  )
                }
              >
                Set all to zero
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-outline-variant">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(11rem,1fr)_minmax(0,1fr)] gap-4 bg-surface-container-low px-4 py-3 text-xs font-medium text-on-surface-variant md:grid">
              <span>Item</span>
              <span>Remaining in transit</span>
              <span>Accepted now</span>
              <span>Left in transit</span>
            </div>
            {rows.map((row, index) => {
              const choice = selection[row.name];
              const state = states[index];
              return (
                <div
                  key={row.name}
                  className="grid gap-4 border-t border-outline-variant p-4 first:border-t-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(11rem,1fr)_minmax(0,1fr)]"
                >
                  <div>
                    <p className="text-sm font-semibold">{row.item_name}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {row.item_code}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-on-surface-variant md:hidden">
                      Remaining in transit
                    </p>
                    <p className="text-sm font-medium">
                      {stockQty(
                        row.remaining_qty / (row.conversion_factor || 1)
                      )}{" "}
                      {row.uom}
                    </p>
                    {row.uom !== row.stock_uom ? (
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {stockQty(row.remaining_qty)} {row.stock_uom}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-xs text-on-surface-variant">
                      <span className="md:sr-only">
                        Accepted quantity for {row.item_name}
                      </span>
                      <input
                        aria-label={`Accepted quantity for ${row.item_name}`}
                        aria-invalid={Boolean(state.error)}
                        aria-describedby={
                          state.error ? `receive-error-${index}` : undefined
                        }
                        type="number"
                        min="0"
                        max={
                          row.remaining_qty /
                          (choice?.uom === row.stock_uom
                            ? 1
                            : row.conversion_factor || 1)
                        }
                        step="any"
                        value={choice?.qty || ""}
                        disabled={busy}
                        onChange={(event) => {
                          const qty = event.target.value;
                          const tracking = row.tracking || [];
                          const stock =
                            Number(qty) *
                            (choice?.uom === row.stock_uom
                              ? 1
                              : row.conversion_factor || 1);
                          update(row.name, {
                            qty,
                            ...(stock === 0
                              ? {
                                  allocations: tracking.length ? [] : undefined,
                                }
                              : tracking.length === 1 && !tracking[0].serial_no
                              ? {
                                  allocations: [{ ...tracking[0], qty: stock }],
                                }
                              : {}),
                          });
                        }}
                        className="h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-right text-base text-on-surface focus:border-primary"
                      />
                    </label>
                    {row.uom !== row.stock_uom ? (
                      <select
                        aria-label={`Receipt UOM for ${row.item_name}`}
                        value={choice?.uom}
                        disabled={busy}
                        className="mt-2 h-9 w-full rounded-md border border-outline-variant bg-surface px-2 text-sm"
                        onChange={(event) => {
                          const uom = event.target.value;
                          const stock =
                            Number(choice.qty) *
                            (choice.uom === row.stock_uom
                              ? 1
                              : row.conversion_factor || 1);
                          update(row.name, {
                            uom,
                            qty: String(
                              stock /
                                (uom === row.stock_uom
                                  ? 1
                                  : row.conversion_factor || 1)
                            ),
                          });
                        }}
                      >
                        <option value={row.uom}>{row.uom}</option>
                        <option value={row.stock_uom}>{row.stock_uom}</option>
                      </select>
                    ) : (
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {row.uom}
                      </p>
                    )}
                    {!state.error && choice?.uom !== row.stock_uom ? (
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {stockQty(state.stock)} {row.stock_uom}
                      </p>
                    ) : null}
                    {state.error ? (
                      <p
                        id={`receive-error-${index}`}
                        className="mt-1 text-xs text-error"
                      >
                        {state.error}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-on-surface-variant md:hidden">
                      Left in transit
                    </p>
                    <p className="text-sm font-semibold">
                      {state.error
                        ? "—"
                        : `${stockQty(state.left)} ${row.stock_uom}`}
                    </p>
                  </div>
                  {row.tracking?.length ? (
                    <fieldset disabled={busy} className="min-w-0 md:col-span-4">
                      <legend className="mb-2 text-sm font-medium">
                        Batches / serial numbers received · {row.stock_uom}
                      </legend>
                      <p className="mb-2 text-xs text-on-surface-variant">
                        Only stock still in transit is listed. Changing these
                        selections updates the accepted quantity.
                      </p>
                      <div className="max-h-64 overflow-y-auto rounded-md border border-outline-variant divide-y divide-outline-variant">
                        {row.tracking.map((part, partIndex) => {
                          const selected = choice?.allocations?.find(
                            (value) =>
                              value.batch_no === part.batch_no &&
                              value.serial_no === part.serial_no
                          );
                          const select = (qty: number) => {
                            const allocations = (
                              choice?.allocations || []
                            ).filter(
                              (value) =>
                                value.batch_no !== part.batch_no ||
                                value.serial_no !== part.serial_no
                            );
                            if (qty !== 0) allocations.push({ ...part, qty });
                            update(row.name, {
                              allocations,
                              qty: String(
                                Number(
                                  allocations
                                    .reduce(
                                      (total, value) => total + value.qty,
                                      0
                                    )
                                    .toFixed(row.stock_precision ?? 6)
                                )
                              ),
                              uom: row.stock_uom,
                            });
                          };
                          return (
                            <label
                              key={partIndex}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                            >
                              <span className="min-w-0 break-words">
                                {part.serial_no
                                  ? `Serial: ${part.serial_no}`
                                  : `Batch: ${part.batch_no}`}
                                {part.serial_no && part.batch_no ? (
                                  <span className="block text-xs text-on-surface-variant">
                                    Batch: {part.batch_no}
                                  </span>
                                ) : null}
                              </span>
                              {part.serial_no ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(selected)}
                                  onChange={(event) =>
                                    select(event.target.checked ? 1 : 0)
                                  }
                                  aria-label={`Receive serial ${part.serial_no}`}
                                  className="size-5 accent-primary"
                                />
                              ) : (
                                <span className="flex shrink-0 items-center gap-2">
                                  <span className="text-xs text-on-surface-variant">
                                    of {stockQty(part.qty)}
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    max={part.qty}
                                    step="any"
                                    value={selected?.qty ?? 0}
                                    onChange={(event) =>
                                      select(
                                        event.target.value === ""
                                          ? 0
                                          : Number(event.target.value)
                                      )
                                    }
                                    aria-label={`Accepted quantity from batch ${part.batch_no}`}
                                    className="h-touch w-28 rounded-md border border-outline-variant bg-surface px-3 text-right"
                                  />
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}
                </div>
              );
            })}
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-md bg-error-container p-3 text-sm text-on-error-container"
            >
              {error}
            </p>
          ) : null}
          {!online ? (
            <p role="alert" className="mt-4 text-sm text-error">
              Connect to the server to receive stock.
            </p>
          ) : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-outline-variant bg-surface p-4 sm:p-5">
          <div>
            <p className="text-sm font-medium">
              {accepted} of {rows.length} items selected
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {partial
                ? "Partial receipt — unaccepted quantities remain in transit."
                : "All remaining quantities selected."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || !online || invalid}
              onClick={() =>
                onReceive(
                  rows.map((row, index) => ({
                    source_row: row.name,
                    qty: states[index].qty,
                    uom: selection[row.name].uom,
                    allocations:
                      states[index].stock > 0
                        ? selection[row.name].allocations
                        : [],
                  })),
                  key
                )
              }
            >
              {busy ? "Receiving…" : "Receive stock"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
