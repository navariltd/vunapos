import { useFrappeGetCall } from "frappe-react-sdk";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { KitchenTicketDTO } from "../types";
import { Sheet } from "./Sheet";
import { KitchenActions } from "./KitchenActions";
import { kitchenStatusClass } from "../kitchenStatus";

export function KitchenTicketSheet({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const response = useFrappeGetCall<unknown>(
    vunaMethods.getKitchenTicket,
    { ticket: name },
    ["kitchen-ticket", name],
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
      title={name}
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
        <div className="space-y-4">
          <div className="rounded-lg bg-surface-container-low p-3 text-sm">
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
              Sent {new Date(ticket.sent_at.replace(" ", "T")).toLocaleString()}{" "}
              · {ticket.sent_by}
            </p>
          </div>
          {ticket.order_note ? (
            <p className="rounded-md border border-outline-variant p-3 text-sm">
              {ticket.order_note}
            </p>
          ) : null}
          <ul className="divide-y divide-outline-variant">
            {ticket.items.map((item) => (
              <li
                key={item.line_id}
                className={`py-3 ${item.parent_line_id ? "pl-5" : ""}`}
              >
                <p className="text-sm font-semibold">
                  {quantity(item.qty)} {item.uom} × {item.item_name}
                </p>
                {item.parent_line_id ? (
                  <p className="text-xs text-on-surface-variant">Add-on</p>
                ) : null}
                {item.work_order ? (
                  <p className="text-xs text-on-surface-variant">
                    Production: {item.work_order}
                  </p>
                ) : null}
                {item.uom !== item.stock_uom ? (
                  <p className="text-xs text-on-surface-variant">
                    {quantity(item.stock_qty)} {item.stock_uom}
                  </p>
                ) : null}
                {item.modifiers.length ? (
                  <p className="mt-1 text-sm">
                    {item.modifiers.map((choice) => choice.label).join(" · ")}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {item.note}
                  </p>
                ) : null}
                {item.temporary_routing ? (
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Temporary station selection
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {ticket.available_actions?.length || ticket.can_cancel_order ? (
            <KitchenActions
              ticket={ticket}
              onChanged={() => void response.mutate()}
            />
          ) : null}
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
                    {action.reason ? <p>{action.reason}</p> : null}
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
      )}
    </Sheet>
  );
}
