import { boxCenter, legibleFontSize, screenPxToCanvas } from "../floorPlanGeometry";
import type { FloorElementDTO, FloorElementType } from "../types";

const MIN_TEXT_PX = 10;

// Theme tokens, so decor follows light and dark mode unless a colour is set.
const ELEMENT_STYLE: Record<FloorElementType, { fill: string; stroke: string }> = {
  Wall: { fill: "var(--color-on-surface-variant)", stroke: "none" },
  Door: { fill: "var(--color-tertiary-container)", stroke: "var(--color-tertiary)" },
  Window: { fill: "var(--color-surface)", stroke: "var(--color-outline)" },
  "Bar Counter": { fill: "var(--color-tertiary-container)", stroke: "var(--color-tertiary)" },
  Plant: { fill: "var(--color-secondary-container)", stroke: "var(--color-secondary)" },
  Label: { fill: "none", stroke: "none" },
};

type ElementShapeProps = {
  element: Pick<FloorElementDTO, "element_type" | "label" | "x" | "y" | "width" | "height" | "rotation" | "color">;
  scale: number;
  selected?: boolean;
};

export function ElementShape({ element, scale, selected }: ElementShapeProps) {
  const center = boxCenter(element);
  const style = ELEMENT_STYLE[element.element_type] || ELEMENT_STYLE.Wall;
  const strokeWidth = screenPxToCanvas(1.5, scale);
  const { x, y, width, height } = element;

  if (element.element_type === "Label") {
    return (
      <g transform={`rotate(${element.rotation} ${center.x} ${center.y})`}>
        {selected ? (
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill="none"
            stroke="var(--color-primary)"
            strokeDasharray={`${screenPxToCanvas(4, scale)} ${screenPxToCanvas(3, scale)}`}
            strokeWidth={strokeWidth}
          />
        ) : null}
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={legibleFontSize(Math.min(28, height * 0.7), MIN_TEXT_PX, scale)}
          fontWeight={600}
          fill={element.color || "var(--color-on-surface-variant)"}
          className="pointer-events-none select-none"
        >
          {element.label || "Label"}
        </text>
      </g>
    );
  }

  const fill = element.color || style.fill;
  const stroke = selected ? "var(--color-primary)" : style.stroke;
  return (
    <g transform={`rotate(${element.rotation} ${center.x} ${center.y})`}>
      {element.element_type === "Plant" ? (
        <ellipse cx={center.x} cy={center.y} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={element.element_type === "Bar Counter" ? Math.min(6, height / 3) : 0}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {element.element_type === "Window" ? (
        <line x1={x} y1={center.y} x2={x + width} y2={center.y} stroke={style.stroke} strokeWidth={strokeWidth} />
      ) : null}
      {element.element_type === "Door" ? (
        // A swing line from the hinge corner, enough to read as a door at a glance.
        <line x1={x} y1={y + height} x2={x + width} y2={y} stroke={style.stroke} strokeWidth={strokeWidth} />
      ) : null}
      {element.label ? (
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={legibleFontSize(Math.min(14, height * 0.5), MIN_TEXT_PX, scale)}
          fill="var(--color-on-surface)"
          className="pointer-events-none select-none"
        >
          {element.label}
        </text>
      ) : null}
    </g>
  );
}
