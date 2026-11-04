import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Minus, Plus, Search, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import {
  activeSelectionFloors,
  findFloorTables,
  initialSelectionFloor,
  uniqueExactFloorTable,
} from "../floorPlanSelection";
import { useNow } from "../hooks/useNow";
import { deriveTableStatuses, legendStatuses, statusFor } from "../tableStatus";
import type {
  FloorPlanDTO,
  RestaurantTableDTO,
  TableStatusDTO,
} from "../types";
import { FloorCanvas } from "./FloorCanvas";
import { FloorTabs } from "./FloorTabs";
import { StatusLegend } from "./StatusLegend";

type Props = {
  plan: FloorPlanDTO | null;
  statuses: TableStatusDTO[] | null;
  selectedTables: string[];
  multiple?: boolean;
  busy?: boolean;
  error?: string | null;
  loading?: boolean;
  onRetry: () => void;
  onSelect: (table: RestaurantTableDTO) => void;
  onClose: () => void;
  footer?: ReactNode;
};

/** Mounted only while open: the existing floor drawing becomes a table selector. */
export function TablePlanPicker({
  plan,
  statuses,
  selectedTables,
  multiple,
  busy,
  error,
  loading,
  onRetry,
  onSelect,
  onClose,
  footer,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [floorName, setFloorName] = useState(() =>
    initialSelectionFloor(plan?.floors || [], selectedTables)
  );
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const now = useNow();
  const floors = useMemo(
    () => activeSelectionFloors(plan?.floors || []),
    [plan]
  );
  const floor =
    floors.find((row) => row.name === floorName) ??
    floors.find(
      (row) => row.name === initialSelectionFloor(floors, selectedTables)
    ) ??
    floors[0];
  const views = useMemo(() => deriveTableStatuses(statuses || []), [statuses]);
  const selected = useMemo(() => new Set(selectedTables), [selectedTables]);
  const matches = useMemo(
    () => findFloorTables(floors, query),
    [floors, query]
  );
  const ready = Boolean(plan && statuses);

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Never focus the input automatically: that would open the mobile keyboard.
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  const close = () => {
    if (!busy) onClose();
  };
  const activate = (table: RestaurantTableDTO) => {
    if (!ready || busy) return;
    setQuery("");
    onSelect(table);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
      ) || []),
    ].filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-surface text-on-surface shadow-xl sm:h-[92dvh] sm:max-w-7xl sm:rounded-xl sm:border sm:border-outline-variant"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant p-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {multiple ? "Assign tables" : "Select table"}
            </h2>
            <p id={descriptionId} className="text-xs text-on-surface-variant">
              {multiple
                ? "Select tables to join, then confirm. Occupied tables belonging to other sessions cannot be joined."
                : "Select a free table to return to items, or an occupied table to reopen its session."}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            disabled={busy}
            aria-label="Close table selection"
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-surface-container disabled:opacity-40"
            onClick={close}
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-outline-variant px-4 py-3">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <FloorTabs
              tabs={floors.map((row) => ({
                key: row.name,
                label: row.floor_name,
              }))}
              activeKey={floor?.name || null}
              onChange={(name) => {
                setFloorName(name);
                setZoom(1);
              }}
            />
          </div>
          <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-on-surface-variant" />
            <input
              aria-label="Find table by number"
              placeholder="Find table number"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={!ready || busy}
              className="h-10 w-full rounded-md border border-outline-variant bg-surface pl-9 pr-3 text-sm"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const match = uniqueExactFloorTable(floors, query);
                  if (match) {
                    setFloorName(match.floor.name);
                    activate(match.table);
                  }
                }
              }}
            />
          </label>
          <div className="flex items-center gap-1" aria-label="Floor plan zoom">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
            >
              <Minus className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
              Fit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Zoom in"
              disabled={zoom >= 3}
              onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        {error ? (
          <p
            role="alert"
            className="shrink-0 bg-error-container px-4 py-2 text-sm text-on-error-container"
          >
            {error}
          </p>
        ) : null}
        {query.trim() ? (
          <div
            className="max-h-40 shrink-0 overflow-y-auto border-b border-outline-variant p-3"
            aria-live="polite"
          >
            {matches.length ? (
              <ul aria-label="Matching tables" className="flex flex-wrap gap-2">
                {matches.map(({ floor: area, table }) => (
                  <li key={table.name}>
                    <button
                      type="button"
                      disabled={!ready || busy}
                      className="cursor-pointer rounded-md border border-outline-variant px-3 py-2 text-left text-sm hover:bg-surface-container"
                      aria-pressed={selected.has(table.name)}
                      onClick={() => {
                        setFloorName(area.name);
                        activate(table);
                      }}
                    >
                      <strong>Table {table.table_label}</strong> ·{" "}
                      {area.floor_name}
                      <span className="block text-xs text-on-surface-variant">
                        {statusFor(views, table.name).kind === "occupied"
                          ? "Occupied"
                          : "Free"}{" "}
                        · {table.seats} seats
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-on-surface-variant">
                No matching active tables.
              </p>
            )}
          </div>
        ) : null}
        <div
          className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-surface-container-low p-2 sm:p-4"
          aria-busy={loading}
        >
          {!ready ? (
            <EmptyState
              title={loading ? "Loading floor plan" : "Floor plan unavailable"}
              description={error || "Fetching tables and occupancy."}
              action={
                !loading ? <Button onClick={onRetry}>Retry</Button> : undefined
              }
            />
          ) : !floor ? (
            <EmptyState
              title="No floors configured"
              description="Ask a manager to configure the restaurant floor plan."
            />
          ) : (
            <div
              style={{
                width: `${zoom * 100}%`,
                height: `${zoom * 100}%`,
                minHeight: "100%",
              }}
            >
              <FloorCanvas
                floor={floor}
                statuses={views}
                selectedTables={selected}
                now={now}
                onTableActivate={busy ? undefined : activate}
              />
            </div>
          )}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-outline-variant p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
            <StatusLegend
              statuses={
                floor && ready
                  ? legendStatuses(
                      floor.tables.map((table) => statusFor(views, table.name))
                    )
                  : []
              }
            />
            <span>
              {multiple ? `${selectedTables.length} selected · ` : ""}Use + to
              zoom; scroll or swipe to move around.
            </span>
          </div>
          {footer}
        </footer>
      </div>
    </div>
  );
}
