import type { KitchenTicketDTO } from "../types";
import { kitchenDishGroups } from "../kitchenDishes";
import { KitchenLineProgress } from "./KitchenLineProgress";
import { KitchenLineActions } from "./KitchenActions";

const quantity = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);

function Instruction({ note }: { note?: string | null }) {
  return note ? (
    <p className="mt-2 whitespace-pre-wrap rounded bg-tertiary-container p-2 text-sm font-medium text-on-tertiary-container">
      {note}
    </p>
  ) : null;
}

export function KitchenDishes({
  ticket,
  details = false,
}: {
  ticket: KitchenTicketDTO;
  details?: boolean;
}) {
  return (
    <ul className="flex-1 divide-y divide-outline-variant">
      {kitchenDishGroups(ticket.items).map(({ dish, addons, modifiers }) => (
        <li key={dish.line_id} className="py-3">
          <p className="text-sm font-semibold">
            {quantity(dish.qty)} {dish.uom} × {dish.item_name}
          </p>
          {ticket.status !== "Cancelled" ? (
            <KitchenLineProgress line={dish} />
          ) : null}
          {modifiers.length ? (
            <p className="mt-1 text-sm">
              {modifiers.map((choice) => choice.label).join(" · ")}
            </p>
          ) : null}
          {addons.length ? (
            <ul
              aria-label={`Add-ons for ${dish.item_name}`}
              className="mt-2 space-y-1 border-l-2 border-outline-variant pl-3"
            >
              {addons.map(({ line, label, note }) => (
                <li key={line.line_id} className="text-sm">
                  <p>
                    +{" "}
                    {line.qty !== dish.qty || line.uom !== dish.uom
                      ? `${quantity(line.qty)} ${line.uom} × `
                      : ""}
                    {label}
                  </p>
                  <Instruction note={note} />
                  {details && line.work_order ? (
                    <p className="text-xs text-on-surface-variant">
                      Production: {line.work_order}
                    </p>
                  ) : null}
                  {details && line.uom !== line.stock_uom ? (
                    <p className="text-xs text-on-surface-variant">
                      {quantity(line.stock_qty)} {line.stock_uom}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <Instruction note={dish.note} />
          {details ? (
            <>
              {dish.work_order ? (
                <p className="mt-1 text-xs text-on-surface-variant">
                  Production: {dish.work_order}
                </p>
              ) : null}
              {dish.uom !== dish.stock_uom ? (
                <p className="text-xs text-on-surface-variant">
                  {quantity(dish.stock_qty)} {dish.stock_uom}
                </p>
              ) : null}
              {dish.temporary_routing ? (
                <p className="text-xs text-on-surface-variant">
                  Temporary station selection
                </p>
              ) : null}
            </>
          ) : null}
          <KitchenLineActions line={dish} />
        </li>
      ))}
    </ul>
  );
}
