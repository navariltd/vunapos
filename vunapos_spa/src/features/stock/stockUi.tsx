import { statusBadgeClass } from "../pos/utils";

export function StockStatus({
  status,
  workflow = false,
}: {
  status: string;
  workflow?: boolean;
}) {
  const colour = [
    "Awaiting receipt",
    "Partially received",
    "Partially Ordered",
    "Partially Transferred",
  ].includes(status)
    ? "bg-tertiary-container text-on-tertiary-container"
    : ["Received", "Transferred", "Ordered"].includes(status)
    ? "bg-secondary-container text-on-secondary-container"
    : statusBadgeClass(status, workflow);
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
        workflow ? statusBadgeClass(status, true) : colour
      }`}
    >
      {status}
    </span>
  );
}
