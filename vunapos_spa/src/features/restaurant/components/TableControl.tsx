import { Armchair } from "lucide-react";

import { Button } from "../../../components/ui/Button";

type TableControlProps = {
  tableLabel: string | null;
  // Before the first save the table can be chosen or changed; after it, it's shown only.
  canChange: boolean;
  onPick: () => void;
};

// The table for a service type that uses one.
export function TableControl({ tableLabel, canChange, onPick }: TableControlProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-outline-variant px-3 py-2">
      <Armchair className="size-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
        {tableLabel ? (
          <>
            Table <strong className="font-semibold">{tableLabel}</strong>
          </>
        ) : (
          <span className="text-on-surface-variant">No table chosen</span>
        )}
      </span>
      {canChange ? (
        <Button size="sm" variant={tableLabel ? "ghost" : "primary"} className="h-9 shrink-0" onClick={onPick}>
          {tableLabel ? "Change" : "Choose table"}
        </Button>
      ) : null}
    </div>
  );
}
