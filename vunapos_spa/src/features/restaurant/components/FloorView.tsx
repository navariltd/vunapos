import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { navigateToOrder, navigateToPosPage } from "../../../lib/stores/navigationStore";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useFloorPlan } from "../hooks/useFloorPlan";
import { useNow } from "../hooks/useNow";
import { useTableStatus } from "../hooks/useOrderData";
import { useStartOrder } from "../hooks/useStartOrder";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { legendStatuses, statusFor, tableServiceType, tableTapAction } from "../tableStatus";
import type { RestaurantTableDTO, TableOrderRefDTO } from "../types";
import { FloorCanvas } from "./FloorCanvas";
import { FloorTabs } from "./FloorTabs";
import { NewOrderButton } from "./NewOrderButton";
import { StatusLegend } from "./StatusLegend";
import { TableOrdersSheet } from "./TableOrdersSheet";

type FloorViewProps = {
  posProfile?: string;
};

// Service mode: everyone sees the active layout with each table's status, polled
// while the floor is on screen. Managers also receive inactive rows (for the
// editor), so they are filtered out here.
export function FloorView({ posProfile }: FloorViewProps) {
  const { plan, error, isLoading, reload } = useFloorPlan(posProfile);
  const status = useTableStatus(posProfile);
  const bootstrap = useBootstrapData();
  const startOrder = useStartOrder();
  const now = useNow();
  const pickingTableFor = useOrderDraftStore((s) => s.pickingTableFor);
  const setPickingTableFor = useOrderDraftStore((s) => s.setPickingTableFor);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{ table: RestaurantTableDTO; orders: TableOrderRefDTO[] } | null>(null);
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const restaurant = bootstrap.data?.restaurant;

  // Picking a table only lasts while the floor is on screen.
  useEffect(() => () => setPickingTableFor(null), [setPickingTableFor]);

  const floors = (plan?.floors ?? [])
    .filter((floor) => floor.is_active)
    .map((floor) => ({ ...floor, tables: floor.tables.filter((table) => table.is_active) }));
  const activeFloor = floors.find((floor) => floor.name === selectedFloor) ?? floors[0] ?? null;
  const canEdit = Boolean(plan?.can_edit);
  // Until the first status response, tables stay neutral rather than all "Free".
  const statuses = status.data ? status.statuses : undefined;
  const legend =
    statuses && activeFloor ? legendStatuses(activeFloor.tables.map((table) => statusFor(statuses, table.name))) : [];

  const activateTable = (table: RestaurantTableDTO) => {
    if (!statuses) {
      showToast({ type: "info", message: "Loading table status. Try again in a moment." });
      return;
    }
    const action = tableTapAction(statusFor(statuses, table.name), Boolean(restaurant?.allow_multiple_orders_per_table));
    if (action.kind === "open") {
      setPickingTableFor(null);
      navigateToOrder(action.order);
      return;
    }
    if (action.kind === "choose") {
      setChooser({ table, orders: action.orders });
      return;
    }
    const serviceType = pickingTableFor ?? tableServiceType(restaurant?.service_types ?? []);
    if (!serviceType) {
      showToast({ type: "error", message: "No service type on this POS Profile uses tables." });
      return;
    }
    startOrder(serviceType, table);
  };

  const editButton = canEdit ? (
    <Button variant="ghost" size="sm" className="shrink-0 gap-2" onClick={() => navigateToPosPage("Floor Editor")}>
      <Pencil className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Edit</span>
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
        <FloorCanvas floor={activeFloor} statuses={statuses} now={now} onTableActivate={activateTable} />
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
        {restaurant && !pickingTableFor ? <NewOrderButton /> : null}
      </div>
      {pickingTableFor ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm text-on-surface"
        >
          <span className="min-w-0 flex-1">
            Choose a free table for <strong>{pickingTableFor.service_type_name}</strong>.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPickingTableFor(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
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
      {body}
      <TableOrdersSheet
        tableLabel={chooser?.table.table_label ?? null}
        orders={chooser?.orders ?? []}
        now={now}
        onClose={() => setChooser(null)}
        onOpenOrder={(order) => {
          setChooser(null);
          setPickingTableFor(null);
          navigateToOrder(order);
        }}
        onNewOrder={() => {
          const table = chooser?.table;
          setChooser(null);
          const serviceType = pickingTableFor ?? tableServiceType(restaurant?.service_types ?? []);
          if (table && serviceType) startOrder(serviceType, table);
        }}
      />
    </section>
  );
}
