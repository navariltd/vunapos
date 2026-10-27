import { useState } from "react";
import { Minus, Plus, StickyNote, Trash2 } from "lucide-react";

import { cn } from "../../../lib/cn";
import { formatCurrency } from "../../pos/utils";
import { MAX_NOTE_LENGTH } from "../orderDraft";

type OrderLineRowProps = {
  itemName: string;
  qty: number;
  // The lowest quantity allowed: 1 for unsent lines, the saved quantity for sent ones.
  minQty: number;
  note: string;
  rate?: number;
  currency?: string;
  // Unsent lines only. Sent lines can't be removed or lowered in stage 1.
  onRemove?: () => void;
  changed?: boolean;
  disabled?: boolean;
  onQtyChange: (qty: number) => void;
  onNoteChange: (note: string) => void;
};

export function OrderLineRow({
  itemName,
  qty,
  minQty,
  note,
  rate,
  currency,
  onRemove,
  changed,
  disabled,
  onQtyChange,
  onNoteChange,
}: OrderLineRowProps) {
  const [editingNote, setEditingNote] = useState(false);
  const showNote = editingNote || Boolean(note);

  return (
    <li className={cn("rounded-md border px-3 py-2", changed ? "border-primary bg-primary/5" : "border-outline-variant")}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-on-surface">{itemName}</p>
          {rate !== undefined ? (
            <p className="text-xs text-on-surface-variant">{formatCurrency(rate * qty, currency)}</p>
          ) : (
            <p className="text-xs text-on-surface-variant">Not on the current menu</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-md border border-outline-variant text-on-surface disabled:opacity-40"
            disabled={disabled || qty <= minQty}
            aria-label={`One less ${itemName}`}
            title={!onRemove && qty <= minQty ? "Sent quantities can't be lowered yet" : undefined}
            onClick={() => onQtyChange(qty - 1)}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-8 text-center text-sm font-semibold tabular-nums text-on-surface" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-md border border-outline-variant text-on-surface disabled:opacity-40"
            disabled={disabled}
            aria-label={`One more ${itemName}`}
            onClick={() => onQtyChange(qty + 1)}
          >
            <Plus className="size-4" />
          </button>
          {!showNote ? (
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container disabled:opacity-40"
              disabled={disabled}
              aria-label={`Add a note for ${itemName}`}
              title="Add note"
              onClick={() => setEditingNote(true)}
            >
              <StickyNote className="size-4" />
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-md text-error hover:bg-error-container disabled:opacity-40"
              disabled={disabled}
              aria-label={`Remove ${itemName}`}
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {showNote ? (
        <label className="mt-2 block">
          <span className="sr-only">Note for {itemName}</span>
          <input
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            disabled={disabled}
            autoFocus={editingNote && !note}
            placeholder="Note for the kitchen, e.g. no onions"
            className="h-10 w-full rounded-md border border-outline-variant bg-surface px-3 text-sm text-on-surface outline-none focus:border-primary"
            onChange={(event) => onNoteChange(event.target.value)}
            onBlur={() => setEditingNote(false)}
          />
        </label>
      ) : null}
    </li>
  );
}
