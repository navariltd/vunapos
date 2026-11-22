import type { KitchenTicketDTO } from "../types";
import {
  KITCHEN_TIMING_STAGES,
  kitchenDuration,
  secondsSince,
} from "../kitchenTiming";

export function KitchenTimings({
  ticket,
  now,
}: {
  ticket: KitchenTicketDTO;
  now: Date;
}) {
  const timing = ticket.timing;
  if (!timing) return null;
  const batches = timing.batches || [];
  const finished = timing.finished_at ? new Date(timing.finished_at) : null;
  const closed = ["Served", "Completed", "Cancelled"].includes(ticket.status);
  const total =
    closed && !finished ? null : secondsSince(timing.sent_at, finished || now);
  const totalLabel = closed
    ? ticket.status === "Served"
      ? "Sent → Served"
      : "Sent → Closed"
    : "Total time since sent";
  const time = (value: string | null) =>
    value ? new Date(value).toLocaleString() : "Time not recorded";
  return (
    <section
      aria-label="Kitchen timings"
      className="border-t border-outline-variant pt-4"
    >
      <h3 className="mb-2 text-sm font-semibold">Kitchen timings</h3>
      <dl className="divide-y divide-outline-variant text-sm">
        {Object.entries(KITCHEN_TIMING_STAGES).map(([stage, labels]) => {
          const samples = batches.filter((batch) => batch.stage === stage);
          const known = samples.flatMap((batch) =>
            batch.seconds === null ? [] : [batch.seconds]
          );
          const minimum = known.length ? Math.min(...known) : null;
          const maximum = known.length ? Math.max(...known) : null;
          const duration =
            minimum !== null &&
            maximum !== null &&
            kitchenDuration(minimum) !== kitchenDuration(maximum)
              ? `${kitchenDuration(minimum)} – ${kitchenDuration(maximum)}`
              : kitchenDuration(minimum);
          const pending = timing.stages?.find(
            (row) => row.stage === stage && row.pending
          );
          return (
            <div
              key={stage}
              className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2"
            >
              <dt>{labels.label}</dt>
              <dd className="text-right">
                {samples.length ? (
                  <p className="font-medium">{duration}</p>
                ) : null}
                {pending ? (
                  <p className="text-on-surface-variant">
                    {labels.live} ·{" "}
                    {kitchenDuration(secondsSince(pending.since, now))}
                  </p>
                ) : null}
                {!samples.length && !pending ? (
                  <span className="text-on-surface-variant">
                    Time not recorded
                  </span>
                ) : null}
                {known.length > 0 && known.length < samples.length ? (
                  <p className="text-xs text-on-surface-variant">
                    Some times not recorded
                  </p>
                ) : null}
              </dd>
            </div>
          );
        })}
        <div className="flex justify-between gap-4 py-2 font-semibold">
          <dt>{totalLabel}</dt>
          <dd>{kitchenDuration(total)}</dd>
        </div>
      </dl>
      {batches.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-medium">
            Batch timings
          </summary>
          <p className="mt-2 text-xs text-on-surface-variant">
            Ranges reflect separate quantities. Quantities of the same dish are
            matched in recorded order, not tracked as individual meals. Serving
            corrections start a new service wait.
          </p>
          <ul className="mt-2 divide-y divide-outline-variant">
            {batches.map((batch, index) => {
              const dish = ticket.items.find(
                (item) => item.line_id === batch.line_id
              );
              return (
                <li key={index} className="py-2">
                  <p className="font-medium">
                    {new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 6,
                    }).format(batch.qty)}{" "}
                    {dish?.uom} × {dish?.item_name || batch.line_id}
                  </p>
                  <p>
                    {KITCHEN_TIMING_STAGES[batch.stage].label} ·{" "}
                    {kitchenDuration(batch.seconds)}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {time(batch.started_at)} → {time(batch.finished_at)}
                  </p>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
