import { useFrappeGetCall } from "frappe-react-sdk";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { KitchenTicketDTO } from "../types";
import { Sheet } from "./Sheet";
import { KitchenActions } from "./KitchenActions";
import { kitchenStatusClass } from "../kitchenStatus";
import { KitchenDishes } from "./KitchenDishes";

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
        <KitchenActions
          key={ticket.name}
          ticket={ticket}
          onChanged={() => void response.mutate()}
        >
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
