import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { navigateToPosPage } from "../../../lib/stores/navigationStore";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useFloorPlan } from "../hooks/useFloorPlan";
import { FloorCanvas } from "./FloorCanvas";
import { FloorTabs } from "./FloorTabs";

type FloorViewProps = {
  posProfile?: string;
};

// Service mode: everyone sees the active layout. Managers also receive
// inactive rows (for the editor), so they are filtered out here.
export function FloorView({ posProfile }: FloorViewProps) {
  const { plan, error, isLoading, reload } = useFloorPlan(posProfile);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const showToast = useUiFeedbackStore((s) => s.showToast);

  const floors = (plan?.floors ?? [])
    .filter((floor) => floor.is_active)
    .map((floor) => ({ ...floor, tables: floor.tables.filter((table) => table.is_active) }));
  const activeFloor = floors.find((floor) => floor.name === selectedFloor) ?? floors[0] ?? null;
  const canEdit = Boolean(plan?.can_edit);

  const editButton = canEdit ? (
    <Button variant="ghost" size="sm" className="shrink-0 gap-2" onClick={() => navigateToPosPage("Floor Editor")}>
      <Pencil className="size-4" aria-hidden="true" />
      <span>Edit</span>
    </Button>
  ) : null;

  let body;
  if (!plan && isLoading) {
    body = <EmptyState title="Loading floor plan" description="Fetching floors and tables from ERPNext." />;
  } else if (!plan) {
    body = (
      <EmptyState
        title="Floor plan unavailable"
        description={error || "The floor plan could not be loaded."}
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  } else if (!activeFloor) {
    body = (
      <EmptyState
        title="No floors yet"
        description={
          canEdit
            ? "Use Edit to add a floor and lay out its tables."
            : "Ask a restaurant manager to set up the floor plan for this POS Profile."
        }
        action={editButton}
      />
    );
  } else {
    body = (
      <div className="min-h-0 flex-1 rounded-md border border-outline-variant bg-surface-container-low p-2 sm:p-3">
        <FloorCanvas
          floor={activeFloor}
          onTableActivate={(table) =>
            showToast({ type: "info", message: `Table ${table.table_label}: orders are coming soon.` })
          }
        />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4 pb-[84px] lg:pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="shrink-0 text-base font-semibold text-on-surface">Floor</h2>
        <div className="min-w-0 flex-1">
          {floors.length > 1 ? (
            <FloorTabs
              tabs={floors.map((floor) => ({ key: floor.name, label: floor.floor_name }))}
              activeKey={activeFloor?.name ?? null}
              onChange={setSelectedFloor}
            />
          ) : activeFloor ? (
            <span className="truncate text-sm text-on-surface-variant">{activeFloor.floor_name}</span>
          ) : null}
        </div>
        {activeFloor ? editButton : null}
      </div>
      {body}
    </section>
  );
}
