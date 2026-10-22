import type { KeyboardEvent } from "react";

import { boxCenter, legibleFontSize, screenPxToCanvas } from "../floorPlanGeometry";
import type { RestaurantTableDTO } from "../types";

export type TableStatus = "free" | "occupied" | "bill-requested";

// Derived from open orders once they exist (design decision 3); every table is free for now.
const STATUS_STYLE: Record<TableStatus, { stroke: string; label: string }> = {
  free: { stroke: "var(--color-secondary)", label: "Free" },
  occupied: { stroke: "var(--color-tertiary)", label: "Occupied" },
  "bill-requested": { stroke: "var(--color-error)", label: "Bill requested" },
};

// Readable floors for labels on small screens, in screen pixels.
const MIN_LABEL_PX = 12;
const MIN_SEATS_PX = 10;

type TableShapeProps = {
  table: Pick<
    RestaurantTableDTO,
    "table_label" | "seats" | "shape" | "x" | "y" | "width" | "height" | "rotation" | "color"
  >;
  scale: number;
  status?: TableStatus;
  selected?: boolean;
  muted?: boolean;
  onActivate?: () => void;
};

export function TableShape({ table, scale, status = "free", selected, muted, onActivate }: TableShapeProps) {
  const center = boxCenter(table);
  const statusStyle = STATUS_STYLE[status];
  const strokeWidth = screenPxToCanvas(selected ? 3 : 2, scale);
  const labelSize = legibleFontSize(Math.min(22, table.height * 0.3), MIN_LABEL_PX, scale);
  const seatsSize = legibleFontSize(Math.min(14, table.height * 0.18), MIN_SEATS_PX, scale);
  const isRound = table.shape === "Round" || table.shape === "Oval";
  const fill = table.color || "var(--color-surface)";
  const interactive = Boolean(onActivate);

  return (
    <g
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`Table ${table.table_label}, ${table.seats} seats, ${statusStyle.label.toLowerCase()}`}
      className={interactive ? "cursor-pointer" : undefined}
      opacity={muted ? 0.45 : 1}
      onClick={onActivate}
      onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
        if (onActivate && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <g transform={`rotate(${table.rotation} ${center.x} ${center.y})`}>
        {isRound ? (
          <ellipse
            cx={center.x}
            cy={center.y}
            rx={table.width / 2}
            ry={table.height / 2}
            fill={fill}
            stroke={selected ? "var(--color-primary)" : statusStyle.stroke}
            strokeWidth={strokeWidth}
          />
        ) : (
          <rect
            x={table.x}
            y={table.y}
            width={table.width}
            height={table.height}
            rx={Math.min(8, table.width / 4, table.height / 4)}
            fill={fill}
            stroke={selected ? "var(--color-primary)" : statusStyle.stroke}
            strokeWidth={strokeWidth}
          />
        )}
      </g>
      {/* Text stays upright regardless of the table's rotation. */}
      <text
        x={center.x}
        y={center.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={labelSize}
        fontWeight={600}
        fill="var(--color-on-surface)"
        className="pointer-events-none select-none"
        dy={-seatsSize * 0.45}
      >
        {table.table_label}
      </text>
      <text
        x={center.x}
        y={center.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={seatsSize}
        fill="var(--color-on-surface-variant)"
        className="pointer-events-none select-none"
        dy={labelSize * 0.65}
      >
        {table.seats} {table.seats === 1 ? "seat" : "seats"}
      </text>
    </g>
  );
}
