import { useState } from "react";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { formatCurrency } from "../../pos/utils";
import { MAX_NOTE_LENGTH, type UnsentLine } from "../../restaurant/orderDraft";

type Props = {
  lines: UnsentLine[];
  currency?: string;
  subtotal: number;
  onQty: (lineId: string, qty: number) => void;
  onNote: (lineId: string, note: string) => void;
  onRemove: (lineId: string) => void;
  onEditChoices?: (line: UnsentLine) => void;
  canEditChoices: (line: UnsentLine) => boolean;
  footer: React.ReactNode;
};

// The customer's order so far, with large controls for touch screens.
export function KioskCart({ lines, currency, subtotal, onQty, onNote, onRemove, onEditChoices, canEditChoices, footer }: Props) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="text-xl font-semibold text-on-surface">Your order</h2>
      {lines.length ? (
        <ul className="mt-3 min-h-0 flex-1 divide-y divide-outline-variant overflow-y-auto overscroll-contain">
          {lines.map((line) => (
            <li key={line.line_id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-medium text-on-surface">{line.item_name}</p>
                  {line.modifiers?.length ? (
                    <p className="text-sm text-on-surface-variant">
                      {line.modifiers.map((choice) => choice.label).join(", ")}
                    </p>
                  ) : null}
                  {line.note && noteFor !== line.line_id ? (
                    <p className="text-sm italic text-on-surface-variant">“{line.note}”</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${line.item_name}`}
                  className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-md text-error hover:bg-error-container"
                  onClick={() => onRemove(line.line_id)}
                >
                  <Trash2 className="size-5" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-full border border-outline-variant">
                  <button
                    type="button"
                    aria-label={`One less ${line.item_name}`}
                    disabled={line.qty <= 1}
                    className="flex size-12 cursor-pointer items-center justify-center rounded-full disabled:opacity-40"
                    onClick={() => onQty(line.line_id, line.qty - 1)}
                  >
                    <Minus className="size-5" />
                  </button>
                  <span className="w-8 text-center text-lg font-semibold" aria-live="polite">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    aria-label={`One more ${line.item_name}`}
                    className="flex size-12 cursor-pointer items-center justify-center rounded-full"
                    onClick={() => onQty(line.line_id, line.qty + 1)}
                  >
                    <Plus className="size-5" />
                  </button>
                </div>
                <Button variant="ghost" size="lg" className="gap-2" onClick={() => setNoteFor(noteFor === line.line_id ? null : line.line_id)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  {line.note ? "Edit note" : "Add a note"}
                </Button>
                {onEditChoices && canEditChoices(line) ? (
                  <Button variant="ghost" size="lg" onClick={() => onEditChoices(line)}>
                    Change choices
                  </Button>
                ) : null}
              </div>
              {noteFor === line.line_id ? (
                <label className="mt-2 block">
                  <span className="sr-only">Note for {line.item_name}</span>
                  <input
                    autoFocus
                    className="h-12 w-full rounded-md border border-outline-variant bg-surface px-3 text-base outline-none focus:border-primary"
                    placeholder="For example: no onions"
                    maxLength={MAX_NOTE_LENGTH}
                    value={line.note}
                    enterKeyHint="done"
                    onChange={(event) => onNote(line.line_id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setNoteFor(null);
                    }}
                  />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex-1 text-on-surface-variant">Tap an item on the menu to add it.</p>
      )}
      <div className="mt-3 space-y-3 border-t border-outline-variant pt-3">
        <p className="flex justify-between text-lg font-semibold text-on-surface">
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal, currency)}</span>
        </p>
        {footer}
      </div>
    </div>
  );
}
