import type { KitchenTicketDTO } from "../types";

export function KitchenLineProgress({
  line,
}: {
  line: KitchenTicketDTO["items"][number];
}) {
  if (line.accepted_qty === undefined) return null;
  const buckets = [
    [line.not_accepted_qty, "not accepted"],
    [line.waiting_qty, "waiting"],
    [line.preparing_qty, "preparing"],
    [line.ready_to_serve_qty, "ready to serve"],
    [line.served_qty, "served"],
  ] as const;
  return (
    <p
      className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs"
      aria-label={`Preparation progress for ${line.item_name}`}
    >
      {buckets
        .filter(([qty]) => Number(qty) > 0)
        .map(([qty, label]) => (
          <span
            key={label}
            className={
              label === "ready to serve"
                ? "font-semibold text-emerald-700 dark:text-emerald-300"
                : "text-on-surface-variant"
            }
          >
            {new Intl.NumberFormat(undefined, {
              maximumFractionDigits: 6,
            }).format(qty || 0)}{" "}
            {label}
          </span>
        ))}
    </p>
  );
}
