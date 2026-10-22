import { useRef, type PointerEvent } from "react";

import type { DraftElement, DraftFloor, DraftTable, ItemPatch, Selection } from "../floorPlanDraft";
import { CANVAS_HEIGHT, CANVAS_WIDTH, boxCenter, screenPxToCanvas } from "../floorPlanGeometry";
import { useCanvasGesture } from "../hooks/useCanvasGesture";
import { useCanvasScale } from "../hooks/useCanvasScale";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { ElementShape } from "./ElementShape";
import { SelectionHandles } from "./SelectionHandles";
import { TableShape } from "./TableShape";

// Visual grid only; snapping itself uses the finer GRID_SIZE.
const GRID_LINE_SPACING = 50;

type EditorCanvasProps = {
  floor: DraftFloor;
  selection: Selection;
  snap: boolean;
  disabled?: boolean;
  onSelect: (selection: Selection) => void;
  onChange: (selection: Selection, patch: ItemPatch) => void;
};

export function EditorCanvas({ floor, selection, snap, disabled, onSelect, onChange }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { scale } = useCanvasScale(containerRef);
  const coarse = useCoarsePointer();
  const gesture = useCanvasGesture(svgRef, { snap, disabled, onChange });
  const hairline = screenPxToCanvas(1, scale);

  const selectedTable =
    selection?.kind === "table" ? floor.tables.find((table) => table.key === selection.key) : undefined;
  const selectedElement =
    selection?.kind === "element" ? floor.elements.find((element) => element.key === selection.key) : undefined;
  const selectedBox = selectedTable ?? selectedElement;

  const itemProps = (kind: "table" | "element", item: DraftTable | DraftElement, label: string) => {
    const itemSelection: Selection = { kind, floorKey: floor.key, key: item.key };
    const center = boxCenter(item);
    return {
      role: "button",
      tabIndex: disabled ? -1 : 0,
      "aria-label": label,
      "aria-pressed": selection?.key === item.key,
      className: disabled ? undefined : "cursor-move",
      onFocus: () => onSelect(itemSelection),
      onPointerDown: (event: PointerEvent<SVGGElement>) => {
        onSelect(itemSelection);
        gesture.begin(event, "move", itemSelection, item);
      },
      // A transparent hit area covering the whole rotated box, including labels.
      hitArea: (
        <rect
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          fill="transparent"
          transform={`rotate(${item.rotation} ${center.x} ${center.y})`}
        />
      ),
    };
  };

  return (
    <div ref={containerRef} className="h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full select-none"
        // Stop the page from scrolling or zooming while dragging on touch screens.
        style={{ touchAction: "none" }}
        role="group"
        aria-label={`${floor.floor_name} floor editor`}
        onPointerMove={gesture.onPointerMove}
        onPointerUp={gesture.onPointerUp}
        onPointerCancel={gesture.onPointerCancel}
      >
        <defs>
          <pattern id="floor-editor-grid" width={GRID_LINE_SPACING} height={GRID_LINE_SPACING} patternUnits="userSpaceOnUse">
            <path
              d={`M ${GRID_LINE_SPACING} 0 L 0 0 0 ${GRID_LINE_SPACING}`}
              fill="none"
              stroke="var(--color-outline-variant)"
              strokeWidth={hairline}
            />
          </pattern>
        </defs>
        <rect
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          fill={floor.background_color || "var(--color-surface-container-low)"}
          stroke="var(--color-outline)"
          strokeWidth={hairline}
          onPointerDown={() => onSelect(null)}
        />
        {floor.background_image ? (
          <image
            href={floor.background_image}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            preserveAspectRatio="xMidYMid meet"
            opacity={0.5}
            pointerEvents="none"
          />
        ) : null}
        {snap ? (
          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#floor-editor-grid)" pointerEvents="none" />
        ) : null}
        {floor.elements.map((element) => {
          const { hitArea, ...props } = itemProps("element", element, `${element.label || element.element_type}, decor`);
          return (
            <g key={element.key} {...props}>
              <ElementShape element={element} scale={scale} selected={selection?.key === element.key} />
              {hitArea}
            </g>
          );
        })}
        {floor.tables.map((table) => {
          const { hitArea, ...props } = itemProps(
            "table",
            table,
            `Table ${table.table_label}${table.is_active ? "" : ", inactive"}`,
          );
          return (
            <g key={table.key} {...props}>
              <TableShape
                table={table}
                scale={scale}
                selected={selection?.key === table.key}
                muted={!table.is_active}
              />
              {hitArea}
            </g>
          );
        })}
        {selectedBox && selection && !disabled ? (
          <SelectionHandles
            box={selectedBox}
            scale={scale}
            coarse={coarse}
            onResizeStart={(event, handle) => gesture.begin(event, "resize", selection, selectedBox, handle)}
            onRotateStart={(event) => gesture.begin(event, "rotate", selection, selectedBox)}
          />
        ) : null}
      </svg>
    </div>
  );
}
