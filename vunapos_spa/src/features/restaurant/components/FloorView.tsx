import { useEffect, useState } from "react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { navigateToOrder, replacePosPage } from "../../../lib/stores/navigationStore";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useFloorPlan } from "../hooks/useFloorPlan";
import { useNow } from "../hooks/useNow";
import { useMenu, useTableStatus } from "../hooks/useOrderData";
import { useTablePicker } from "../hooks/useTablePicker";
import { floorWarnings } from "../menuConflicts";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { legendStatuses, statusFor } from "../tableStatus";
import type { RestaurantTableDTO, TableOrderRefDTO } from "../types";
import { ConflictDialog } from "./ConflictDialog";
import { FloorCanvas } from "./FloorCanvas";
import { FloorTabs } from "./FloorTabs";
import { OccupiedTableSheet } from "./OccupiedTableSheet";
import { StatusLegend } from "./StatusLegend";

type FloorViewProps = {
  posProfile?: string;
};

// The table picker: the active layout with each table's live status, shown only
// while the order being built needs a table (otherwise it goes back to the order).
// Floors that can't serve some of the order are marked; nothing is blocked.
// Managers also receive inactive rows (for the editor), so they are filtered out.
export function FloorView({ posProfile }: FloorViewProps) {
  const draft = useOrderDraftStore((s) => s.draft);
  const picking = useOrderDraftStore((s) => s.picking);
  const setPicking = useOrderDraftStore((s) => s.setPicking);
  const active = Boolean(picking && draft && !draft.order);
  const { plan, error, isLoading, reload } = useFloorPlan(active ? posProfile : undefined);
  const status = useTableStatus(active ? posProfile : undefined);
  // The draft's service type across every floor, to warn about floors that can't serve it.
  const pickerMenu = useMenu(active ? posProfile : undefined, draft?.service_type, null).menu;
  const picker = useTablePicker(posProfile, pickerMenu);
  const bootstrap = useBootstrapData();
  const now = useNow();
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [occupied, setOccupied] = useState<{ table: RestaurantTableDTO; orders: TableOrderRefDTO[] } | null>(null);
  const restaurant = bootstrap.data?.restaurant;

  // Picking ends when another page opens (RestaurantApp); without it, the floor
  // has no use and goes back to the order.
  useEffect(() => {
    if (!active) replacePosPage("Order");
  }, [active]);

  const floors = (plan?.floors ?? [])
    .filter((floor) => floor.is_active)
    .map((floor) => ({ ...floor, tables: floor.tables.filter((table) => table.is_active) }));
  const activeFloor = floors.find((floor) => floor.name === selectedFloor) ?? floors[0] ?? null;
  // Until the first status response, tables stay neutral rather than all "Free".
  const statuses = status.data ? status.statuses : undefined;
  const legend =
    statuses && activeFloor ? legendStatuses(activeFloor.tables.map((table) => statusFor(statuses, table.name))) : [];
  const warnings = floorWarnings(draft?.unsent ?? [], pickerMenu, floors.map((floor) => floor.name));
  const activeWarning = activeFloor ? (warnings.get(activeFloor.name) ?? null) : null;
  const serviceTypeName =
    restaurant?.service_types.find((row) => row.name === draft?.service_type)?.service_type_name ?? draft?.service_type;

  const activateTable = (table: RestaurantTableDTO) => {
    if (!statuses) {
      showToast({ type: "info", message: "Loading table status. Try again in a moment." });
      return;
    }
    const view = statusFor(statuses, table.name);
    if (view.kind === "occupied" && view.orders.length) {
      setOccupied({ table, orders: view.orders });
      return;
    }
    picker.pickTable(table);
  };

  const backToOrder = () => {
    setPicking(null);
    navigateToOrder(null);
  };

  if (!active) return null;

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
        description="Ask a restaurant manager to set up the floor plan for this POS Profile."
      />
    );
  } else {
    body = (
      <div className="min-h-0 flex-1 rounded-md border border-outline-variant bg-surface-container-low p-2 sm:p-3">
        <FloorCanvas
          floor={activeFloor}
          statuses={statuses}
          now={now}
          warning={activeWarning}
          onTableActivate={activateTable}
        />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4 pb-[84px] lg:pb-4">
      <div role="status" className="flex min-w-0 items-center gap-3 rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm text-on-surface">
        <span className="min-w-0 flex-1">
          Choose a table for <strong>{serviceTypeName}</strong>
          {picking?.then === "send" ? ". The order is sent once you choose." : "."}
        </span>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={backToOrder}>
          Cancel
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="shrink-0 text-base font-semibold text-on-surface">Tables</h2>
        <div className="min-w-0 flex-1">
          {floors.length > 1 ? (
            <FloorTabs
              tabs={floors.map((floor) => ({ key: floor.name, label: floor.floor_name, warning: warnings.get(floor.name) }))}
              activeKey={activeFloor?.name ?? null}
              onChange={setSelectedFloor}
            />
          ) : activeFloor ? (
            <span className="truncate text-sm text-on-surface-variant">{activeFloor.floor_name}</span>
          ) : null}
        </div>
      </div>
      {activeFloor ? (
        <div className="flex min-h-5 flex-wrap items-center justify-between gap-2">
          <StatusLegend statuses={legend} />
          {status.error ? (
            <span className="text-xs text-error" role="status">
              Table status could not be refreshed. Retrying.
            </span>
          ) : null}
        </div>
      ) : null}
      {activeWarning && activeFloor ? (
        <p className="rounded-md bg-tertiary-container px-3 py-2 text-sm text-on-tertiary-container" role="note">
          {activeWarning.replace(/ here$/, ` on ${activeFloor.floor_name}`)}. You can still choose a table here.
        </p>
      ) : null}
      {body}
      <OccupiedTableSheet
        tableLabel={occupied?.table.table_label ?? null}
        orders={occupied?.orders ?? []}
        now={now}
        allowSeparate={Boolean(restaurant?.allow_multiple_orders_per_table)}
        busy={picker.busy}
        onClose={() => setOccupied(null)}
        onAddToOrder={(order) => {
          void picker.addToOrder(order).then((done) => {
            if (done) setOccupied(null);
          });
        }}
        onStartSeparate={() => {
          const table = occupied?.table;
          setOccupied(null);
          if (table) picker.pickTable(table);
        }}
      />
      <ConflictDialog prompt={picker.conflict} onClose={picker.clearConflict} />
    </section>
  );
}
