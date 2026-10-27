import { TABLE_STATUS_LABEL, type TableStatusKind } from "../tableStatus";
import { STATUS_ICON } from "./statusIcons";

const BADGE: Record<TableStatusKind, string> = {
  free: "bg-status-free",
  occupied: "bg-status-occupied",
};

const SWATCH: Record<TableStatusKind, string> = {
  free: "border-dashed border-status-free bg-status-free-container",
  occupied: "border-solid border-status-occupied bg-status-occupied-container",
};

// Lists only the statuses currently on the floor. Each swatch repeats the
// table's outline style (dashed free, solid occupied), then the badge icon small
// tables show instead of the status text, then the status name.
export function StatusLegend({ statuses }: { statuses: TableStatusKind[] }) {
  if (!statuses.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant" aria-label="Table status legend">
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`inline-block size-3.5 rounded-sm border-2 ${SWATCH[status]}`} aria-hidden="true" />
          <StatusIcon status={status} />
          {TABLE_STATUS_LABEL[status]}
        </li>
      ))}
    </ul>
  );
}

function StatusIcon({ status }: { status: TableStatusKind }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`flex size-4 items-center justify-center rounded-full text-surface ${BADGE[status]}`} aria-hidden="true">
      <Icon className="size-2.5" strokeWidth={3} />
    </span>
  );
}
