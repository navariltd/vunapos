import { KitchenNotes } from "./KitchenNotes";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useRef, useState } from "react";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { KitchenTicketDTO } from "../types";
import { Sheet } from "../../../components/ui/Sheet";
import { KitchenActions } from "./KitchenActions";
import { kitchenStatusClass } from "../kitchenStatus";
import { KitchenDishes } from "./KitchenDishes";
import { Button } from "../../../components/ui/Button";
import { printHtml } from "../../../lib/printHtml";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";

export function KitchenTicketSheet({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const activeName = linkedName || name;
  const printCall = useFrappePostCall(vunaMethods.renderKitchenTicket);
  const toast = useUiFeedbackStore((s) => s.showToast);
  const printingRef = useRef(false);
  const [printing, setPrinting] = useState(false);
  async function printTicket(action?: string) {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    try {
      const result = unwrapVunaResponse<{ ticket: string; html: string }>(
        await printCall.call({ ticket: activeName, ...(action ? { action } : {}) })
      );
      printHtml(result.html);
    } catch (error) {
      toast({ type: "error", message: error instanceof Error ? error.message : "Unable to print ticket" });
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }
  const response = useFrappeGetCall<unknown>(
    vunaMethods.getKitchenTicket,
    { ticket: activeName },
    ["kitchen-ticket", activeName],
    {
      refreshInterval: 12000,
      refreshWhenHidden: false,
      shouldRetryOnError: false,
    }
  );
  let ticket: KitchenTicketDTO | null = null;
  let error = response.error?.message;
  try {
    if (response.data)
      ticket = unwrapVunaResponse<KitchenTicketDTO>(response.data);
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Unable to load kitchen ticket";
  }
  const quantity = (value: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(
      value
    );
  return (
    <Sheet
      isOpen
      title={activeName}
      description={
        ticket
          ? `${ticket.station_label} · ${ticket.status}`
          : "Kitchen order ticket"
      }
      onClose={onClose}
    >
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : !ticket ? (
        <p className="text-sm text-on-surface-variant">
          Loading kitchen ticket…
        </p>
      ) : (
        <KitchenActions
          key={ticket.name}
          ticket={ticket}
          onChanged={() => void response.mutate()}
        >
          <div className="space-y-4">
            {ticket.can_print ? (
              <div className="space-y-2">
                <Button variant="ghost" disabled={printing} onClick={() => void printTicket()}>
                  {printing ? "Opening print dialog…" : "Print ticket"}
                </Button>
                <p className="text-xs text-on-surface-variant">
                  Prints a manual copy of the original order. Check current preparation activity before making food.
                </p>
              </div>
            ) : null}
            {ticket.production_completed_at_billing ? (
              <p
                role="status"
                className="rounded-md bg-status-paid-container p-3 text-sm text-on-surface"
              >
                Paid. This order was billed before it was made, so its stock has
                already moved. Preparation actions record progress without
                moving stock again.
              </p>
            ) : null}
            <div className="rounded-lg bg-surface-container-low p-3 text-sm">
              {ticket.remake_of ? (
                <div className="mb-3 border-b border-outline-variant pb-3">
                  <p className="font-semibold text-primary">
                    Replacement preparation — no extra charge
                  </p>
                  <button
                    className="cursor-pointer underline"
                    onClick={() => setLinkedName(ticket.remake_of!)}
                  >
                    Original ticket: {ticket.remake_of}
                  </button>
                  <p>{ticket.remake_reason}</p>
                  <p className="text-xs text-on-surface-variant">
                    Original food: {ticket.original_disposition}
                  </p>
                  {ticket.replacement_stock_issues?.length ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {ticket.replacement_stock_issues.map((entry) => (
                        <li key={entry.name}>
                          <a
                            className="underline"
                            href={`/desk/stock-entry/${encodeURIComponent(
                              entry.name
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Replacement stock issue · {entry.name}
                          </a>
                          {entry.docstatus === 2 ? " · Cancelled" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {linkedName && linkedName !== name ? (
                <button
                  className="mb-2 block cursor-pointer underline"
                  onClick={() => setLinkedName(null)}
                >
                  Back to first ticket
                </button>
              ) : null}
              <span
                className={`mb-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${kitchenStatusClass(
                  ticket.status
                )}`}
              >
                {ticket.status}
              </span>
              <p>
                {ticket.sales_order} · {ticket.service_type}
              </p>
              <p>
                {ticket.table_labels
                  ? `Tables: ${ticket.table_labels}`
                  : "No table"}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                Sent{" "}
                {new Date(ticket.sent_at.replace(" ", "T")).toLocaleString()} ·{" "}
                {ticket.sent_by_name || ticket.sent_by}
              </p>
              {ticket.waiter ? (
                <p className="mt-1 text-sm">
                  Waiter: {ticket.waiter_name || ticket.waiter}
                </p>
              ) : null}
            </div>
            {ticket.order_note ? (
              <p className="rounded-md border border-outline-variant p-3 text-sm">
                {ticket.order_note}
              </p>
            ) : null}
            <KitchenDishes ticket={ticket} details />
            {ticket.can_update_notes ? <KitchenNotes key={ticket.name} ticket={ticket} refresh={() => void response.mutate()} /> : null}
            {ticket.actions?.length ? (
              <details className="rounded-md border border-outline-variant p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Preparation activity
                </summary>
                <ul className="mt-2 space-y-2">
                  {ticket.actions.map((action) => (
                    <li key={action.name} className="text-xs">
                      <p className="font-medium">
                        {action.action} · {action.outcome} · {action.actor}
                      </p>
                      <p className="text-on-surface-variant">
                        {action.occurred_at} · {action.from_status} →{" "}
                        {action.to_status}
                      </p>
                      {action.item_quantities?.deltas ? (
                        <ul>
                          {Object.entries(action.item_quantities.deltas).map(
                            ([lineId, qty]) => {
                              const line = ticket.items.find(
                                (item) => item.line_id === lineId
                              );
                              return (
                                <li key={lineId}>
                                  {quantity(qty)} {line?.uom} ×{" "}
                                  {line?.item_name || lineId}
                                </li>
                              );
                            }
                          )}
                        </ul>
                      ) : null}
                      {action.reason ? <p>{action.reason}</p> : null}
                      {ticket.can_print && action.outcome === "Succeeded" &&
                        (["Cancel Items", "Stop Preparation", "Cancel Order", "Update preparation notes"].includes(action.action) || (action.action === "Cancel Remake" && ticket.remake_of && action.to_status === "Cancelled")) ? (
                        <Button variant="ghost" disabled={printing} onClick={() => void printTicket(action.name)}>
                          {action.action === "Update preparation notes" ? "Print ticket" : "Print cancellation"}
                        </Button>
                      ) : null}
                      {action.item_quantities?.charge ? (
                        <p className="font-medium">
                          Charge decision:{" "}
                          {action.item_quantities.charge === "Remove charge"
                            ? "Charge waived"
                            : "Charge kept"}
                        </p>
                      ) : null}
                      {action.action === "Stop Preparation" ? (
                        <div className="space-y-1">
                          {action.item_quantities?.charge_item ? (
                            <p>
                              Cancellation charge:{" "}
                              {action.item_quantities.charge_item}
                            </p>
                          ) : null}
                          {action.item_quantities?.materials?.map((part) => (
                            <p key={part.id}>
                              {part.item_name}: {quantity(part.used_qty)}{" "}
                              {part.uom} used/spoiled;{" "}
                              {quantity(part.max_qty - part.used_qty)}{" "}
                              {part.uom}{" "}
                              {part.kind === "WIP"
                                ? "returned to stores"
                                : "released unused"}
                            </p>
                          ))}
                          {action.item_quantities?.stock_entries?.map(
                            (entry) => (
                              <a
                                key={entry}
                                className="block underline"
                                href={`/desk/stock-entry/${encodeURIComponent(
                                  entry
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Stock entry · {entry}
                              </a>
                            )
                          )}
                        </div>
                      ) : null}
                      {action.item_quantities?.replacement_ticket ? (
                        <p>
                          <button
                            className="cursor-pointer underline"
                            onClick={() =>
                              setLinkedName(
                                action.item_quantities!.replacement_ticket!
                              )
                            }
                          >
                            View replacement ·{" "}
                            {action.item_quantities.replacement_ticket}
                          </button>
                          {action.item_quantities.disposition ? (
                            <span className="block">
                              Original food:{" "}
                              {action.item_quantities.disposition}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {action.item_quantities?.journal_entry ? (
                        <a
                          className="underline"
                          href={`/desk/journal-entry/${encodeURIComponent(
                            action.item_quantities.journal_entry
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Waste accounting entry ·{" "}
                          {action.item_quantities.journal_entry}
                        </a>
                      ) : null}
                      {action.error_message ? (
                        <p className="text-error">{action.error_message}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-xs text-on-surface-variant">
              Preparation instructions remain an immutable snapshot. Progress
              actions are recorded separately.
            </p>
          </div>
        </KitchenActions>
      )}
    </Sheet>
  );
}
