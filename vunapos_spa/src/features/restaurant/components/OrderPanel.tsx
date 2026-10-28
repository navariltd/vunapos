import type { CachedServiceType } from "../../../lib/types";
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
import { ServiceTypeChips } from "./ServiceTypeChips";
import { TableControl } from "./TableControl";

type OrderPanelProps = {
  draft: OrderDraft;
  rates: Map<string, number>;
  currency?: string;
  readOnly: boolean;
  serviceTypes: CachedServiceType[];
  // The service type whose menu is being checked before switching to it.
  checkingServiceType?: string | null;
  serviceTypeMessage?: string | null;
  onChange: (update: (draft: OrderDraft) => OrderDraft) => void;
  onSelectServiceType: (serviceType: CachedServiceType) => void;
  onPickTable: () => void;
};

// The order: its service type and table, who for, and its lines. Before the first
// save the service type and table can change freely. Sent lines can only go up in
// quantity (lowering removes items, stage 2); unsent lines are fully editable.
export function OrderPanel({
  draft,
  rates,
  currency,
  readOnly,
  serviceTypes,
  checkingServiceType,
  serviceTypeMessage,
  onChange,
  onSelectServiceType,
  onPickTable,
}: OrderPanelProps) {
  const header = effectiveHeader(draft);
  const sent = draft.order?.items ?? [];
  const isNew = !draft.order;
  const serviceType = serviceTypes.find((row) => row.name === draft.service_type);

  return (
    <div className="min-w-0 space-y-4">
      <ServiceTypeChips
        serviceTypes={serviceTypes}
        value={draft.service_type}
        readOnly={!isNew || readOnly}
        checking={checkingServiceType}
        message={serviceTypeMessage}
        onSelect={onSelectServiceType}
      />
      {serviceType?.requires_table || draft.table ? (
        <TableControl tableLabel={draft.table_label} canChange={isNew && !readOnly} onPick={onPickTable} />
      ) : null}
      {draft.order ? <p className="-mt-2 text-xs text-on-surface-variant">{draft.order.name}</p> : null}

      <div className={readOnly ? "pointer-events-none min-w-0 opacity-60" : "min-w-0"}>
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
