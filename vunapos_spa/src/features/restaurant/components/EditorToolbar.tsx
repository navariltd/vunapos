import { ChevronDown, Copy, Grid3x3, Layers, Plus, Save, SlidersHorizontal, Trash2, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/cn";
import { ELEMENT_DEFAULTS } from "../floorPlanDraft";
import type { FloorElementType } from "../types";

const ELEMENT_TYPES = Object.keys(ELEMENT_DEFAULTS) as FloorElementType[];

type EditorToolbarProps = {
  hasFloor: boolean;
  hasSelection: boolean;
  snap: boolean;
  dirty: boolean;
  saving: boolean;
  onAddFloor: () => void;
  onAddTable: () => void;
  onAddElement: (elementType: FloorElementType) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleSnap: () => void;
  onOpenProperties: () => void;
  onCancel: () => void;
  onSave: () => void;
};

// Labels collapse to icons below `sm`; every button keeps an accessible name.
export function EditorToolbar({
  hasFloor,
  hasSelection,
  snap,
  dirty,
  saving,
  onAddFloor,
  onAddTable,
  onAddElement,
  onDuplicate,
  onDelete,
  onToggleSnap,
  onOpenProperties,
  onCancel,
  onSave,
}: EditorToolbarProps) {
  const toolClass = "gap-2 px-2.5 sm:px-3";
  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Floor editor tools">
      <Button variant="ghost" size="sm" className={toolClass} onClick={onAddFloor} disabled={saving} aria-label="Add floor">
        <Layers className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Floor</span>
      </Button>
      <Button variant="ghost" size="sm" className={toolClass} onClick={onAddTable} disabled={!hasFloor || saving} aria-label="Add table">
        <Plus className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Table</span>
      </Button>
      <label className={cn("relative", (!hasFloor || saving) && "pointer-events-none opacity-50")}>
        <span className="sr-only">Add decor</span>
        <select
          className="h-9 appearance-none rounded-md bg-surface-container py-0 pl-3 pr-8 text-sm font-medium text-on-surface hover:bg-surface-container-high"
          value=""
          disabled={!hasFloor || saving}
          onChange={(event) => {
            if (event.target.value) onAddElement(event.target.value as FloorElementType);
          }}
        >
          <option value="">Decor</option>
          {ELEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
      </label>
      <Button variant="ghost" size="sm" className={toolClass} onClick={onDuplicate} disabled={!hasSelection || saving} aria-label="Duplicate">
        <Copy className="size-4" aria-hidden="true" />
        <span className="hidden md:inline">Duplicate</span>
      </Button>
      <Button variant="ghost" size="sm" className={toolClass} onClick={onDelete} disabled={!hasSelection || saving} aria-label="Delete">
        <Trash2 className="size-4" aria-hidden="true" />
        <span className="hidden md:inline">Delete</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn(toolClass, snap && "bg-primary-container text-on-primary-container hover:bg-primary-container")}
        onClick={onToggleSnap}
        aria-pressed={snap}
        aria-label="Snap to grid"
        title="Snap to grid"
      >
        <Grid3x3 className="size-4" aria-hidden="true" />
        <span className="hidden md:inline">Snap</span>
      </Button>
      {/* The panel is always visible on large screens; smaller ones open it as a sheet. */}
      <Button variant="ghost" size="sm" className={cn(toolClass, "lg:hidden")} onClick={onOpenProperties} aria-label="Properties">
        <SlidersHorizontal className="size-4" aria-hidden="true" />
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" className={toolClass} onClick={onCancel} disabled={saving} aria-label="Cancel">
          <X className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Cancel</span>
        </Button>
        <Button size="sm" className={toolClass} onClick={onSave} disabled={!dirty || saving} aria-label="Save floor plan">
          <Save className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{saving ? "Saving..." : "Save"}</span>
        </Button>
      </div>
    </div>
  );
}
