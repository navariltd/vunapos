import type { PointerEvent } from "react";

import { boxCenter, screenPxToCanvas, type Box, type ResizeHandle } from "../floorPlanGeometry";

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

type SelectionHandlesProps = {
  box: Box;
  scale: number;
  // Touch screens get larger targets.
  coarse: boolean;
  onResizeStart: (event: PointerEvent<SVGElement>, handle: ResizeHandle) => void;
  onRotateStart: (event: PointerEvent<SVGElement>) => void;
};

export function SelectionHandles({ box, scale, coarse, onResizeStart, onRotateStart }: SelectionHandlesProps) {
  const size = screenPxToCanvas(coarse ? 22 : 10, scale);
  const half = size / 2;
  const stroke = screenPxToCanvas(1.5, scale);
  const rotateOffset = screenPxToCanvas(coarse ? 36 : 26, scale);
  const center = boxCenter(box);
  const { x, y, width, height } = box;
  // Edge handles would cover a small box entirely; keep only the corners then.
  const showEdges = width > size * 3 && height > size * 3;
  const positions: Array<[ResizeHandle, number, number]> = [
    ["nw", x, y],
    ["ne", x + width, y],
    ["se", x + width, y + height],
    ["sw", x, y + height],
    ...(showEdges
      ? ([
          ["n", center.x, y],
          ["e", x + width, center.y],
          ["s", center.x, y + height],
          ["w", x, center.y],
        ] as Array<[ResizeHandle, number, number]>)
      : []),
  ];

  return (
    <g transform={`rotate(${box.rotation} ${center.x} ${center.y})`}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={stroke}
        strokeDasharray={`${screenPxToCanvas(5, scale)} ${screenPxToCanvas(3, scale)}`}
        pointerEvents="none"
      />
      <line
        x1={center.x}
        y1={y}
        x2={center.x}
        y2={y - rotateOffset}
        stroke="var(--color-primary)"
        strokeWidth={stroke}
        pointerEvents="none"
      />
      <circle
        cx={center.x}
        cy={y - rotateOffset}
        r={half}
        fill="var(--color-surface)"
        stroke="var(--color-primary)"
        strokeWidth={stroke}
        style={{ cursor: "grab" }}
        aria-label="Rotate"
        onPointerDown={onRotateStart}
      />
      {positions.map(([handle, hx, hy]) => (
        <rect
          key={handle}
          x={hx - half}
          y={hy - half}
          width={size}
          height={size}
          rx={screenPxToCanvas(2, scale)}
          fill="var(--color-surface)"
          stroke="var(--color-primary)"
          strokeWidth={stroke}
          style={{ cursor: HANDLE_CURSOR[handle] }}
          aria-label={`Resize ${handle}`}
          onPointerDown={(event) => onResizeStart(event, handle)}
        />
      ))}
    </g>
  );
}
