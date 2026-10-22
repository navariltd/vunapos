import { useRef } from "react";

import { CANVAS_HEIGHT, CANVAS_WIDTH, screenPxToCanvas } from "../floorPlanGeometry";
import { useCanvasScale } from "../hooks/useCanvasScale";
import type { RestaurantFloorDTO, RestaurantTableDTO } from "../types";
import { ElementShape } from "./ElementShape";
import { TableShape } from "./TableShape";

type FloorCanvasProps = {
  floor: Pick<RestaurantFloorDTO, "floor_name" | "background_color" | "background_image" | "elements" | "tables">;
  onTableActivate?: (table: RestaurantTableDTO) => void;
};

// Read-only floor drawing on the fixed 1000 x 700 virtual canvas. The SVG
// viewBox scales it to the container while keeping the aspect ratio.
export function FloorCanvas({ floor, onTableActivate }: FloorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale } = useCanvasScale(containerRef);

  return (
    <div ref={containerRef} className="h-full w-full">
      <svg
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
        role="group"
        aria-label={`${floor.floor_name} floor plan`}
      >
        <rect
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          rx={screenPxToCanvas(6, scale)}
          fill={floor.background_color || "var(--color-surface-container-low)"}
          stroke="var(--color-outline-variant)"
          strokeWidth={screenPxToCanvas(1, scale)}
        />
        {floor.background_image ? (
          <image
            href={floor.background_image}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            preserveAspectRatio="xMidYMid meet"
            opacity={0.6}
          />
        ) : null}
        {floor.elements.map((element, index) => (
          <ElementShape key={element.name || index} element={element} scale={scale} />
        ))}
        {floor.tables.map((table) => (
          <TableShape
            key={table.name}
            table={table}
            scale={scale}
            onActivate={onTableActivate ? () => onTableActivate(table) : undefined}
          />
        ))}
      </svg>
    </div>
  );
}
