import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/cn";
import { TablePlanPicker } from "../../restaurant/components/TablePlanPicker";
import type { FloorPlanDTO, RestaurantTableDTO, TableStatusDTO } from "../../restaurant/types";

const TAKEN = "Please ask a member of staff";

type Props = {
  plan: FloorPlanDTO | null;
  statuses: TableStatusDTO[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (table: { name: string; table_label: string }) => void;
  onBack: () => void;
  onStartOver: () => void;
};

// Choosing a dine-in table: the floor plan, or a list of large buttons. Taken tables
// stay visible but can't be chosen.
export function KioskTableStep({ plan, statuses, loading, error, onRetry, onSelect, onBack, onStartOver }: Props) {
  const [view, setView] = useState<"plan" | "list">("plan");
  const [notice, setNotice] = useState<string | null>(null);
  const occupied = new Set((statuses ?? []).filter((row) => row.status === "Occupied").map((row) => row.table));

  const choose = (table: Pick<RestaurantTableDTO, "name" | "table_label">) => {
    if (occupied.has(table.name)) {
      setNotice(`Table ${table.table_label} is taken. ${TAKEN}.`);
      return;
    }
    setNotice(null);
    onSelect(table);
  };

  const toggle = (
    <Button variant="ghost" size="lg" className="gap-2" onClick={() => setView(view === "plan" ? "list" : "plan")}>
      {view === "plan" ? <List className="size-5" aria-hidden="true" /> : <LayoutGrid className="size-5" aria-hidden="true" />}
      {view === "plan" ? "Show as a list" : "Show the floor plan"}
    </Button>
  );

  if (view === "plan")
    return (
      <TablePlanPicker
        plan={plan}
        statuses={statuses}
        selectedTables={[]}
        loading={loading}
        error={notice || error}
        onRetry={onRetry}
        onSelect={choose}
        onClose={onBack}
        title="Where are you sitting?"
        description="Tap your table. The number is on the table."
        footer={
          <div className="flex flex-wrap justify-between gap-2">
            {toggle}
            <Button variant="ghost" size="lg" onClick={onStartOver}>
              Start over
            </Button>
          </div>
        }
      />
    );

  const floors = (plan?.floors ?? []).filter((floor) => floor.is_active);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4" aria-labelledby="kiosk-table-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="kiosk-table-title" className="text-2xl font-semibold text-on-surface">
            Where are you sitting?
          </h2>
          <p className="text-on-surface-variant">Tap your table. The number is on the table.</p>
        </div>
        {toggle}
      </div>
      {notice || error ? (
        <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-on-error-container">
          {notice || error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain">
        {floors.map((floor) => (
          <div key={floor.name}>
            {floors.length > 1 ? <h3 className="mb-2 text-lg font-semibold text-on-surface">{floor.floor_name}</h3> : null}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {[...floor.tables]
                .filter((table) => table.is_active)
                .sort((a, b) => a.table_label.localeCompare(b.table_label, undefined, { numeric: true }))
                .map((table) => {
                  const taken = occupied.has(table.name);
                  return (
                    <li key={table.name}>
                      <button
                        type="button"
                        aria-disabled={taken}
                        className={cn(
                          "flex min-h-28 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 p-3 text-center",
                          taken
                            ? "border-outline-variant bg-surface-container text-on-surface-variant opacity-60"
                            : "border-primary bg-surface text-on-surface hover:bg-primary-container",
                        )}
                        onClick={() => choose(table)}
                      >
                        <span className="text-3xl font-bold">{table.table_label}</span>
                        <span className="text-sm">{taken ? TAKEN : `${table.seats} seats`}</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        {!floors.length && !loading ? (
          <p className="text-on-surface-variant">No tables are available here. {TAKEN}.</p>
        ) : null}
      </div>
    </section>
  );
}
