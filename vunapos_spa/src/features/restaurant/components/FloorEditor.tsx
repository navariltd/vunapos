import { useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertCircle, Layers, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { navigateToPosPage, replacePosPage } from "../../../lib/stores/navigationStore";
import { vunaMethods } from "../../../services/vunaApi";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { findFloor, findItem, isDirty, type DraftElement, type DraftTable } from "../floorPlanDraft";
import { GRID_SIZE } from "../floorPlanGeometry";
import { useFloorPlan } from "../hooks/useFloorPlan";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useFloorEditorStore } from "../stores/floorEditorStore";
import type { FloorPlanDTO } from "../types";
import { EditorCanvas } from "./EditorCanvas";
import { EditorToolbar } from "./EditorToolbar";
import { FloorTabs } from "./FloorTabs";
import { PropertiesPanel } from "./PropertiesPanel";

const ARROW_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

type FloorEditorProps = {
  posProfile?: string;
};

export function FloorEditor({ posProfile }: FloorEditorProps) {
  const { plan, error, isLoading, reload } = useFloorPlan(posProfile);
  const saveCall = useFrappePostCall(vunaMethods.saveFloorPlan);
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const editor = useFloorEditorStore();
  const { load, reset, draft, original, selection, activeFloorKey, snap, saving, saveError, conflict } = editor;
  const dirty = isDirty(original, draft);
  const guard = useUnsavedChangesGuard(dirty);
  // Small screens show properties as a sheet: opened by selecting an item or the
  // Properties button, closed per selection.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetClosedFor, setSheetClosedFor] = useState<string | null>(null);
  const loadedPlan = useRef<FloorPlanDTO | null>(null);

  useEffect(() => {
    // Load each fetched plan once. A save updates the store directly, so the
    // older fetched plan must not be loaded over it again.
    if (plan && plan !== loadedPlan.current) {
      loadedPlan.current = plan;
      load(plan);
    }
  }, [plan, load]);

  useEffect(
    () => () => {
      // Forget the loaded plan too, so a remount (including StrictMode's dev
      // double-mount) loads it into the store again instead of staying empty.
      loadedPlan.current = null;
      reset();
    },
    [reset],
  );

  useEffect(() => {
    if (plan && !plan.can_edit) replacePosPage("Floor");
  }, [plan]);

  const floor = draft ? findFloor(draft, activeFloorKey) : undefined;
  const floorIndex = draft && floor ? draft.floors.indexOf(floor) : -1;
  const selectedItem = draft ? findItem(draft, selection) : undefined;
  const table = selection?.kind === "table" ? (selectedItem as DraftTable | undefined) : undefined;
  const element = selection?.kind === "element" ? (selectedItem as DraftElement | undefined) : undefined;
  const selectionKey = selection?.key ?? null;
  const sheetVisible = sheetOpen || (selectionKey !== null && sheetClosedFor !== selectionKey);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || saving) return;
      const state = useFloorEditorStore.getState();
      if (event.key === "Escape") {
        state.select(null);
        return;
      }
      if (!state.selection || !state.draft) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.deleteSelection();
        return;
      }
      const arrow = ARROW_KEYS[event.key];
      const item = findItem(state.draft, state.selection);
      if (arrow && item) {
        event.preventDefault();
        const step = state.snap ? GRID_SIZE : 1;
        state.updateSelected({ x: item.x + arrow[0] * step, y: item.y + arrow[1] * step });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving]);

  const leave = () => (dirty ? guard.requestLeave("Floor") : navigateToPosPage("Floor"));

  const save = async () => {
    if (await editor.save(saveCall.call)) {
      showToast({ type: "info", message: "Floor plan saved." });
    }
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setSheetClosedFor(selectionKey);
  };

  if (!draft) {
    return (
      <section className="flex h-full min-h-0 flex-col p-4 pb-[84px] lg:pb-4">
        {isLoading || !error ? (
          <EmptyState title="Loading floor plan" description="Fetching floors and tables from ERPNext." />
        ) : (
          <EmptyState
            title="Floor plan unavailable"
            description={error}
            action={<Button onClick={reload}>Try again</Button>}
          />
        )}
      </section>
    );
  }

  const panel = (
    <PropertiesPanel
      floor={floor}
      floorIndex={floorIndex}
      floorCount={draft.floors.length}
      table={table}
      element={element}
      disabled={saving}
      onChangeItem={editor.updateSelected}
      onChangeFloor={(patch) => floor && editor.updateFloor(floor.key, patch)}
      onMoveFloor={(direction) => floor && editor.moveFloor(floor.key, direction)}
      onRemoveFloor={() => floor && editor.removeUnsavedFloor(floor.key)}
    />
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4 pb-[84px] lg:pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="shrink-0 text-base font-semibold text-on-surface">Edit floor plan</h2>
        <div className="min-w-0 flex-1">
          <FloorTabs
            tabs={draft.floors.map((row) => ({ key: row.key, label: row.floor_name || "Untitled", inactive: !row.is_active }))}
            activeKey={activeFloorKey}
            onChange={editor.setActiveFloor}
          />
        </div>
      </div>

      <EditorToolbar
        hasFloor={Boolean(floor)}
        hasSelection={Boolean(selectedItem)}
        snap={snap}
        dirty={dirty}
        saving={saving}
        onAddFloor={editor.addFloor}
        onAddTable={editor.addTable}
        onAddElement={editor.addElement}
        onDuplicate={editor.duplicateSelection}
        onDelete={editor.deleteSelection}
        onToggleSnap={() => editor.setSnap(!snap)}
        onOpenProperties={() => setSheetOpen(true)}
        onCancel={leave}
        onSave={() => void save()}
      />

      {saveError ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{saveError.message}</span>
          <button type="button" className="rounded p-0.5 hover:bg-error/10" aria-label="Dismiss" onClick={editor.dismissError}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-container-low p-2 sm:p-3">
          {floor ? (
            <EditorCanvas
              floor={floor}
              selection={selection}
              snap={snap}
              disabled={saving}
              onSelect={editor.select}
              onChange={editor.updateItem}
            />
          ) : (
            <EmptyState
              title="No floors yet"
              description="Add a floor, then add tables and decor to lay it out."
              action={
                <Button className="gap-2" onClick={editor.addFloor}>
                  <Layers className="size-4" aria-hidden="true" />
                  Add floor
                </Button>
              }
            />
          )}
        </div>
        <aside className="hidden w-80 shrink-0 overflow-y-auto rounded-md border border-outline-variant bg-surface-container-low p-4 lg:block" aria-label="Properties">
          {panel}
        </aside>
      </div>

      {sheetVisible ? (
        <div
          role="dialog"
          aria-label="Properties"
          className="fixed inset-x-0 bottom-[68px] z-30 max-h-[55dvh] overflow-y-auto rounded-t-xl border-t border-outline-variant bg-surface p-4 shadow-lg lg:hidden"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-on-surface">Properties</span>
            <button type="button" className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high" aria-label="Close properties" onClick={closeSheet}>
              <X className="size-4" />
            </button>
          </div>
          {panel}
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={conflict}
        title="Someone else changed this layout"
        description="The floor plan was saved by another user after you opened it. Reload to get their changes. Your unsaved changes here will be lost."
        confirmLabel="Reload"
        cancelLabel="Keep editing"
        onConfirm={() => {
          editor.dismissError();
          reload();
        }}
        onCancel={editor.dismissError}
      />
      <ConfirmDialog
        isOpen={guard.pendingPage !== null}
        danger
        title="Discard unsaved changes?"
        description="You have changes to this floor plan that have not been saved."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => guard.pendingPage && guard.discardAndLeave(guard.pendingPage)}
        onCancel={guard.stay}
      />
    </section>
  );
}
