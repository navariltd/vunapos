import type { KeyboardEvent } from "react";

import { boxCenter, screenPxToCanvas, statusBadgeCenter, tableTextLayout, tableTextLines } from "../floorPlanGeometry";
import {
  tableAccessibleName,
  tableStatusBadge,
  tableStatusLines,
  type TableStatusKind,
  type TableStatusView,
} from "../tableStatus";
import type { RestaurantTableDTO } from "../types";
import { STATUS_ICON } from "./statusIcons";

// Table colour is reserved for order status (design decision 13). Without a
// status (the floor editor), every table uses one neutral style.
const NEUTRAL_FILL = "var(--color-surface)";
const NEUTRAL_STROKE = "var(--color-on-surface-variant)";

// Status colours never stand alone: the status word is drawn on the table (or a
// status icon badge when the text does not fit), the outline differs (dashed
// free, solid occupied) and the legend names them.
const STATUS_STYLE: Record<TableStatusKind, { fill: string; stroke: string; dash: boolean }> = {
  free: { fill: "var(--color-status-free-container)", stroke: "var(--color-status-free)", dash: true },
  occupied: { fill: "var(--color-status-occupied-container)", stroke: "var(--color-status-occupied)", dash: false },
};

type TableShapeProps = {
  table: Pick<RestaurantTableDTO, "table_label" | "seats" | "shape" | "x" | "y" | "width" | "height" | "rotation">;
  scale: number;
  status?: TableStatusView;
  // The clock for the time badge; only used with a status.
  now?: Date;
  selected?: boolean;
  muted?: boolean;
  onActivate?: () => void;
};

export function TableShape({ table, scale, status, now, selected, muted, onActivate }: TableShapeProps) {
  const center = boxCenter(table);
  const strokeWidth = screenPxToCanvas(selected ? 3 : status ? 2.5 : 2, scale);
  const seatsText = `${table.seats} ${table.seats === 1 ? "seat" : "seats"}`;
  // Text stays upright, so a table turned on its side offers its height as width.
  const turned = Math.round(table.rotation / 90) % 2 === 1;
  const textBox = turned ? { ...table, width: table.height, height: table.width } : table;
  const clock = now ?? new Date();
  // Keeps the text inside the shape; secondary lines drop out when they would not fit.
  const statusLines = status ? tableStatusLines(status, table.seats, clock) : [];
  const text = status
    ? tableTextLines(textBox, statusLines, scale)
    : toLines(tableTextLayout(textBox, seatsText, scale), seatsText);
  const badge = status ? tableStatusBadge(status, statusLines, text.lines.length) : null;
  const isRound = table.shape === "Round" || table.shape === "Oval";
  const style = status ? STATUS_STYLE[status.kind] : null;
  const fill = style?.fill ?? NEUTRAL_FILL;
  const stroke = selected ? "var(--color-primary)" : (style?.stroke ?? NEUTRAL_STROKE);
  const dash = style?.dash && !selected ? `${screenPxToCanvas(6, scale)} ${screenPxToCanvas(4, scale)}` : undefined;
  const interactive = Boolean(onActivate);
  const label = status
    ? tableAccessibleName(table.table_label, table.seats, status, clock)
    : `Table ${table.table_label}, ${seatsText}`;

  return (
    <g
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
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
      <title>{label}</title>
      <g transform={`rotate(${table.rotation} ${center.x} ${center.y})`}>
        {isRound ? (
          <ellipse
            cx={center.x}
            cy={center.y}
            rx={table.width / 2}
            ry={table.height / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
          />
        ) : (
          <rect
            x={table.x}
            y={table.y}
            width={table.width}
            height={table.height}
            rx={Math.min(8, table.width / 4, table.height / 4)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
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
      {text.lines.map((line, index) => (
        <text
          key={index}
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={line.size}
          // The status line is emphasised; detail lines are quieter.
          fontWeight={status && index === 0 ? 600 : 400}
          fill={status && index === 0 ? "var(--color-on-surface)" : "var(--color-on-surface-variant)"}
          className="pointer-events-none select-none"
          dy={line.dy}
        >
          {line.text}
        </text>
      ))}
      {badge ? <StatusBadge kind={badge} table={textBox} center={center} scale={scale} /> : null}
    </g>
  );
}

// A fixed-size circle with the status icon on the table's corner.
function StatusBadge({
  kind,
  table,
  center,
  scale,
}: {
  kind: TableStatusKind;
  table: { shape?: string; width: number; height: number };
  center: { x: number; y: number };
  scale: number;
}) {
  const Icon = STATUS_ICON[kind];
  const at = statusBadgeCenter(table, center);
  const radius = screenPxToCanvas(10, scale);
  const iconSize = radius * 1.2;
  return (
    <g className="pointer-events-none" aria-hidden="true">
      <circle
        cx={at.x}
        cy={at.y}
        r={radius}
        fill={STATUS_STYLE[kind].stroke}
        stroke="var(--color-surface)"
        strokeWidth={screenPxToCanvas(1.5, scale)}
      />
      <Icon
        x={at.x - iconSize / 2}
        y={at.y - iconSize / 2}
        width={iconSize}
        height={iconSize}
        color="var(--color-surface)"
        strokeWidth={3}
      />
    </g>
  );
}

// The editor's label + seats layout, in the same shape as tableTextLines.
function toLines(layout: ReturnType<typeof tableTextLayout>, seatsText: string) {
  return {
    label: layout.label,
    labelSize: layout.labelSize,
    labelDy: layout.labelDy,
    lines: layout.seatsSize ? [{ text: seatsText, size: layout.seatsSize, dy: layout.seatsDy }] : [],
  };
}
