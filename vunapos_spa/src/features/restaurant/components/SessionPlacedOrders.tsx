import { Button } from "../../../components/ui/Button";
import { formatCurrency } from "../../pos/utils";
import type { RestaurantSessionDTO } from "../types";
import { CancelOrderItems } from "./CancelOrderItems";

/** Placed quantities are review-only; additions always go through a new round. */
export function SessionPlacedOrders({
  session,
  currency,
  onChanged,
  onTicket,
}: {
  session: RestaurantSessionDTO;
  currency?: string;
  onChanged: () => void;
  onTicket: (name: string) => void;
}) {
  return (
    <div className="space-y-4">
      {!session.rounds.length ? (
        <p className="text-sm text-on-surface-variant">No items placed yet.</p>
      ) : null}
      {session.rounds.map((round, index) => (
        <section
          key={round.name}
          aria-label={`Order ${index + 1}`}
          className="rounded-lg border border-outline-variant bg-surface"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant px-4 py-3 text-sm">
            <div>
              <h3 className="font-semibold">
                Order {index + 1}
                {round.status === "Cancelled" ? " · Cancelled" : ""}
              </h3>
              <p className="text-xs text-on-surface-variant">{round.name}</p>
            </div>
            <span className="font-semibold">
              {formatCurrency(round.grand_total || 0, currency)}
            </span>
          </header>
          <ul className="divide-y divide-outline-variant px-4">
            {round.items.map((line) => (
              <li
                key={line.line_id}
                className={`py-3 ${line.parent_line_id ? "pl-4" : ""}`}
              >
                <div className="flex justify-between gap-4 text-sm">
                  <p className="font-medium">
                    {new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 6,
                    }).format(line.qty)}{" "}
                    {line.uom} × {line.item_name}
                  </p>
                  {line.amount !== undefined ? (
                    <span className="shrink-0">
                      {formatCurrency(line.amount, currency)}
                    </span>
                  ) : null}
                </div>
                {line.modifiers?.length ? (
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {line.modifiers.map((choice) => choice.label).join(" · ")}
                  </p>
                ) : null}
                {line.note ? (
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {line.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            <CancelOrderItems
              order={round.name}
              allowed={
                Boolean(round.can_cancel_items) && session.status === "Open"
              }
              onChanged={onChanged}
            />
            {(session.kitchen_tickets || [])
              .filter((ticket) => ticket.sales_order === round.name)
              .map((ticket) => (
                <Button
                  key={ticket.name}
                  size="sm"
                  variant="ghost"
                  onClick={() => onTicket(ticket.name)}
                >
                  {ticket.station_label} · {ticket.status}
                </Button>
              ))}
          </div>
          {round.cancellations?.length ? (
            <details className="border-t border-outline-variant px-4 py-3 text-sm">
              <summary className="cursor-pointer text-on-surface-variant">
                Cancellation history
              </summary>
              <ul className="mt-2 space-y-2">
                {round.cancellations.map((event, index) => (
                  <li key={index}>
                    <p>
                      {event.items
                        .map(
                          (item) =>
                            `${item.qty} ${item.uom} × ${item.item_name}`
                        )
                        .join(" · ")}{" "}
                      cancelled
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {event.reason} · {event.actor} · {event.occurred_at}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ))}
    </div>
  );
}
