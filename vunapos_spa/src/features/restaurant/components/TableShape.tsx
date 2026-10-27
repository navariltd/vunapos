import type { KeyboardEvent } from "react";

import { boxCenter, screenPxToCanvas, tableTextLayout } from "../floorPlanGeometry";
import type { RestaurantTableDTO } from "../types";

// Table colour is reserved for order status (design decision 13). Until the order
// flow supplies a status, every table uses one neutral style.
const NEUTRAL_FILL = "var(--color-surface)";
const NEUTRAL_STROKE = "var(--color-on-surface-variant)";

type TableShapeProps = {
  table: Pick<RestaurantTableDTO, "table_label" | "seats" | "shape" | "x" | "y" | "width" | "height" | "rotation">;
  scale: number;
  selected?: boolean;
  muted?: boolean;
  onActivate?: () => void;
};

export function TableShape({ table, scale, selected, muted, onActivate }: TableShapeProps) {
  const center = boxCenter(table);
  const strokeWidth = screenPxToCanvas(selected ? 3 : 2, scale);
  const seatsText = `${table.seats} ${table.seats === 1 ? "seat" : "seats"}`;
  // Text stays upright, so a table turned on its side offers its height as width.
  const turned = Math.round(table.rotation / 90) % 2 === 1;
  // Keeps the text inside the shape; the seat count drops out when it would not fit.
  const text = tableTextLayout(
    turned ? { ...table, width: table.height, height: table.width } : table,
    seatsText,
    scale,
  );
  const isRound = table.shape === "Round" || table.shape === "Oval";
  const stroke = selected ? "var(--color-primary)" : NEUTRAL_STROKE;
  const interactive = Boolean(onActivate);

  return (
    <g
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`Table ${table.table_label}, ${table.seats} seats`}
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
            fill={NEUTRAL_FILL}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ) : (
          <rect
            x={table.x}
            y={table.y}
            width={table.width}
            height={table.height}
            rx={Math.min(8, table.width / 4, table.height / 4)}
            fill={NEUTRAL_FILL}
            stroke={stroke}
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
        fontSize={text.labelSize}
        fontWeight={600}
        fill="var(--color-on-surface)"
        className="pointer-events-none select-none"
        dy={text.labelDy}
      >
        {text.label}
      </text>
      {text.seatsSize ? (
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={text.seatsSize}
          fill="var(--color-on-surface-variant)"
          className="pointer-events-none select-none"
          dy={text.seatsDy}
        >
          {seatsText}
        </text>
      ) : null}
    </g>
  );
}
