import { TABLE_STATUS_LABEL, type TableStatusKind } from "../tableStatus";

const SWATCH: Record<TableStatusKind, string> = {
  free: "border-dashed border-status-free bg-status-free-container",
  occupied: "border-solid border-status-occupied bg-status-occupied-container",
};

// Lists only the statuses currently on the floor. Each swatch repeats the
// table's outline style (dashed free, solid occupied) next to the status name.
export function StatusLegend({ statuses }: { statuses: TableStatusKind[] }) {
  if (!statuses.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant" aria-label="Table status legend">
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`inline-block size-3.5 rounded-sm border-2 ${SWATCH[status]}`} aria-hidden="true" />
          {TABLE_STATUS_LABEL[status]}
        </li>
      ))}
    </ul>
  );
}
