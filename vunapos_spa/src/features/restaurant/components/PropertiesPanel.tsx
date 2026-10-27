import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { ELEMENT_DEFAULTS, type DraftElement, type DraftFloor, type DraftTable, type ItemPatch } from "../floorPlanDraft";
import type { FloorElementType, RestaurantTableShape } from "../types";

const TABLE_SHAPES: RestaurantTableShape[] = ["Square", "Round", "Rectangle", "Oval"];
const ELEMENT_TYPES = Object.keys(ELEMENT_DEFAULTS) as FloorElementType[];

const inputClass =
  "h-9 w-full rounded-md border border-outline-variant bg-surface px-2 text-sm text-on-surface outline-none hover:border-outline focus:border-primary";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

// Commits on blur or Enter, so a value can be cleared and retyped freely.
function NumberField({
  label,
  value,
  min,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const rounded = Math.round(value * 100) / 100;
  return (
    <Field label={label}>
      <input
        // Remount when the value changes elsewhere (e.g. a drag) to show it.
        key={rounded}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        defaultValue={rounded}
        className={inputClass}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next) && next !== rounded) onCommit(next);
          else event.target.value = String(rounded);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

function ColorField({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  return (
    <Field label="Colour">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#ffffff"}
          className="h-9 w-12 cursor-pointer rounded-md border border-outline-variant bg-surface p-1"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button variant="ghost" size="sm" disabled={!value} onClick={() => onChange(null)}>
          Theme default
        </Button>
      </div>
    </Field>
  );
}

function SizeFields({ item, onChange }: { item: DraftTable | DraftElement; onChange: (patch: ItemPatch) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Width" value={item.width} min={10} onCommit={(width) => onChange({ width })} />
        <NumberField label="Height" value={item.height} min={10} onCommit={(height) => onChange({ height })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="X" value={item.x} min={0} onCommit={(x) => onChange({ x })} />
        <NumberField label="Y" value={item.y} min={0} onCommit={(y) => onChange({ y })} />
      </div>
      <NumberField label="Rotation (degrees)" value={item.rotation} step={15} onCommit={(rotation) => onChange({ rotation })} />
    </>
  );
}

type PropertiesPanelProps = {
  floor: DraftFloor | undefined;
  floorIndex: number;
  floorCount: number;
  table?: DraftTable;
  element?: DraftElement;
  disabled?: boolean;
  onChangeItem: (patch: ItemPatch) => void;
  onChangeFloor: (patch: Partial<Pick<DraftFloor, "floor_name" | "is_active" | "background_color">>) => void;
  onMoveFloor: (direction: -1 | 1) => void;
  onRemoveFloor: () => void;
};

export function PropertiesPanel({
  floor,
  floorIndex,
  floorCount,
  table,
  element,
  disabled,
  onChangeItem,
  onChangeFloor,
  onMoveFloor,
  onRemoveFloor,
}: PropertiesPanelProps) {
  if (!floor) {
    return <p className="text-sm text-on-surface-variant">Add a floor to start laying out tables.</p>;
  }

  if (table) {
    return (
      <fieldset disabled={disabled} className="space-y-4">
        <legend className="text-sm font-semibold text-on-surface">Table</legend>
        <Field label="Label">
          <input className={inputClass} value={table.table_label} onChange={(event) => onChangeItem({ table_label: event.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Seats" value={table.seats} min={1} onCommit={(seats) => onChangeItem({ seats })} />
          <Field label="Shape">
            <select
              className={inputClass}
              value={table.shape}
              onChange={(event) => onChangeItem({ shape: event.target.value as RestaurantTableShape })}
            >
              {TABLE_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {shape}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <SizeFields item={table} onChange={onChangeItem} />
        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={table.is_active} onChange={(event) => onChangeItem({ is_active: event.target.checked })} />
          Active (shown in service)
        </label>
      </fieldset>
    );
  }

  if (element) {
    return (
      <fieldset disabled={disabled} className="space-y-4">
        <legend className="text-sm font-semibold text-on-surface">Decor</legend>
        <Field label="Type">
          <select
            className={inputClass}
            value={element.element_type}
            onChange={(event) => onChangeItem({ element_type: event.target.value as FloorElementType })}
          >
            {ELEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            className={inputClass}
            value={element.label ?? ""}
            placeholder={element.element_type === "Label" ? "Text to show" : "Optional"}
            onChange={(event) => onChangeItem({ label: event.target.value || null })}
          />
        </Field>
        <SizeFields item={element} onChange={onChangeItem} />
        <ColorField value={element.color} onChange={(color) => onChangeItem({ color })} />
      </fieldset>
    );
  }

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="text-sm font-semibold text-on-surface">Floor</legend>
      <Field label="Floor name">
        <input className={inputClass} value={floor.floor_name} onChange={(event) => onChangeFloor({ floor_name: event.target.value })} />
      </Field>
      <ColorField value={floor.background_color} onChange={(background_color) => onChangeFloor({ background_color })} />
      <label className="flex items-center gap-2 text-sm text-on-surface">
        <input type="checkbox" checked={floor.is_active} onChange={(event) => onChangeFloor({ is_active: event.target.checked })} />
        Active (shown in service)
      </label>
      <div className="space-y-1">
        <span className="text-xs font-medium text-on-surface-variant">Order</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="gap-1" disabled={floorIndex <= 0} onClick={() => onMoveFloor(-1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            Move left
          </Button>
          <Button variant="ghost" size="sm" className="gap-1" disabled={floorIndex >= floorCount - 1} onClick={() => onMoveFloor(1)}>
            Move right
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {floor.name ? (
        <p className="text-xs text-on-surface-variant">
          Saved floors can be deactivated but not deleted here.
        </p>
      ) : (
        <Button variant="danger" size="sm" className="gap-2" onClick={onRemoveFloor}>
          <Trash2 className="size-4" aria-hidden="true" />
          Remove unsaved floor
        </Button>
      )}
      <p className="text-xs text-on-surface-variant">Select a table or decor item to edit it.</p>
    </fieldset>
  );
}
