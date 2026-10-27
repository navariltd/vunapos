import { Minus, Plus } from "lucide-react";

import { CustomerSelector } from "../../pos/components/CustomerSelector";
import {
  MAX_NOTE_LENGTH,
  effectiveHeader,
  removeUnsent,
  sentNote,
  sentQty,
  setHeader,
  setSentNote,
  setSentQty,
  setUnsentNote,
  setUnsentQty,
  type OrderDraft,
} from "../orderDraft";
import { OrderLineRow } from "./OrderLineRow";

type OrderPanelProps = {
  draft: OrderDraft;
  rates: Map<string, number>;
  currency?: string;
  readOnly: boolean;
  onChange: (update: (draft: OrderDraft) => OrderDraft) => void;
  onChangeContext?: () => void;
};

// The order: where it is, who for, and its lines. Sent lines can only go up in
// quantity (lowering removes items, stage 2); unsent lines are fully editable.
export function OrderPanel({ draft, rates, currency, readOnly, onChange, onChangeContext }: OrderPanelProps) {
  const header = effectiveHeader(draft);
  const sent = draft.order?.items ?? [];
  // Only before the first save; stage 1 has no switch on a saved order.
  const canChangeContext = !draft.order && Boolean(onChangeContext);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-surface-container px-3 py-1 font-medium text-on-surface">{draft.service_type}</span>
        {draft.table_label ? (
          <span className="rounded-full bg-surface-container px-3 py-1 font-medium text-on-surface">Table {draft.table_label}</span>
        ) : null}
        {draft.order ? <span className="text-xs text-on-surface-variant">{draft.order.name}</span> : null}
        {canChangeContext ? (
          <button type="button" className="text-xs font-medium text-primary underline" onClick={onChangeContext}>
            Change
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <span className="mb-1 block text-xs font-medium text-on-surface-variant">Guests</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-md border border-outline-variant disabled:opacity-40"
              disabled={readOnly || header.pax <= 0}
              aria-label="One guest fewer"
              onClick={() => onChange((current) => setHeader(current, { pax: effectiveHeader(current).pax - 1 }))}
            >
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
              {header.pax}
            </span>
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-md border border-outline-variant disabled:opacity-40"
              disabled={readOnly}
              aria-label="One guest more"
              onClick={() => onChange((current) => setHeader(current, { pax: effectiveHeader(current).pax + 1 }))}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <div className={readOnly ? "min-w-0 pointer-events-none opacity-60" : "min-w-0"}>
          <span className="mb-1 block text-xs font-medium text-on-surface-variant">Customer</span>
          <CustomerSelector
            allowCreate={false}
            posProfile={draft.pos_profile}
            selectedCustomer={
              header.customer ? { customer: header.customer, customer_name: header.customer_name || header.customer } : null
            }
            onSelect={(customer) =>
              onChange((current) => setHeader(current, { customer: customer.customer, customer_name: customer.customer_name }))
            }
            onClear={() => onChange((current) => setHeader(current, { customer: null, customer_name: null }))}
          />
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-on-surface-variant">Order note</span>
        <textarea
          value={header.order_note}
          maxLength={MAX_NOTE_LENGTH}
          rows={2}
          disabled={readOnly}
          placeholder="e.g. Anniversary, bring dessert with a candle"
          className="w-full resize-none rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
          onChange={(event) => onChange((current) => setHeader(current, { order_note: event.target.value }))}
        />
      </label>

      {sent.length ? (
        <section aria-label="Sent">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Sent</h3>
          <ul className="space-y-2">
            {sent.map((line) => (
              <OrderLineRow
                key={line.line_id}
                itemName={line.item_name}
                qty={sentQty(draft, line.line_id)}
                minQty={line.qty}
                note={sentNote(draft, line.line_id)}
                rate={rates.get(line.item_code)}
                currency={currency}
                changed={Boolean(draft.edits[line.line_id])}
                disabled={readOnly}
                onQtyChange={(qty) => onChange((current) => setSentQty(current, line.line_id, qty))}
                onNoteChange={(note) => onChange((current) => setSentNote(current, line.line_id, note))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Not sent yet">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
          Not sent yet{draft.unsent.length ? ` (${draft.unsent.length})` : ""}
        </h3>
        {draft.unsent.length ? (
          <ul className="space-y-2">
            {draft.unsent.map((line) => (
              <OrderLineRow
                key={line.line_id}
                itemName={line.item_name}
                qty={line.qty}
                minQty={1}
                note={line.note}
                rate={rates.get(line.item_code)}
                currency={currency}
                changed
                disabled={readOnly}
                onQtyChange={(qty) => onChange((current) => setUnsentQty(current, line.line_id, qty))}
                onNoteChange={(note) => onChange((current) => setUnsentNote(current, line.line_id, note))}
                onRemove={() => onChange((current) => removeUnsent(current, line.line_id))}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-outline-variant px-3 py-4 text-center text-sm text-on-surface-variant">
            {readOnly ? "This order can no longer be changed." : "Tap items on the menu to add them."}
          </p>
        )}
      </section>
    </div>
  );
}
