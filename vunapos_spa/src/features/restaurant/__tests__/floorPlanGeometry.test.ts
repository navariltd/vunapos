import { describe, expect, it } from "vitest";

import {
	CANVAS_HEIGHT,
	CANVAS_WIDTH,
	MIN_BOX_SIZE,
	clampBox,
	fitCanvas,
	legibleFontSize,
	moveBox,
	normalizeRotation,
	resizeBox,
	rotationFromPointer,
	screenPxToCanvas,
	screenToCanvas,
	snapAngle,
	snapValue,
	tableTextLayout,
	type Box,
} from "../floorPlanGeometry";

const box = (values: Partial<Box> = {}): Box => ({ x: 100, y: 100, width: 80, height: 80, rotation: 0, ...values });

describe("fitCanvas", () => {
	it("fills the width and letterboxes vertically in a wide container", () => {
		expect(fitCanvas(2000, 2000)).toEqual({ scale: 2, offsetX: 0, offsetY: 300 });
	});

	it("fills the height and letterboxes horizontally in a tall-ratio-limited container", () => {
		const fit = fitCanvas(1000, 350);
		expect(fit.scale).toBe(0.5);
		expect(fit.offsetX).toBe(250);
		expect(fit.offsetY).toBe(0);
	});

	it("returns a zero scale for an unmeasured container", () => {
		expect(fitCanvas(0, 500)).toEqual({ scale: 0, offsetX: 0, offsetY: 0 });
	});
});

describe("screenToCanvas", () => {
	it("maps screen pixels to canvas units through the scale and letterbox", () => {
		const rect = { left: 20, top: 10, width: 500, height: 500 };
		// scale 0.5, vertical letterbox of (500 - 350) / 2 = 75px
		expect(screenToCanvas(20, 85, rect)).toEqual({ x: 0, y: 0 });
		expect(screenToCanvas(520, 435, rect)).toEqual({ x: CANVAS_WIDTH, y: CANVAS_HEIGHT });
		expect(screenToCanvas(270, 260, rect)).toEqual({ x: 500, y: 350 });
	});

	it("does not divide by zero before the container is measured", () => {
		expect(screenToCanvas(50, 50, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
	});
});

describe("screen-constant sizes", () => {
	it("converts screen pixels to canvas units", () => {
		expect(screenPxToCanvas(10, 0.5)).toBe(20);
		expect(screenPxToCanvas(10, 2)).toBe(5);
	});

	it("keeps text at its base size on large screens and grows it on small ones", () => {
		expect(legibleFontSize(16, 12, 1.5)).toBe(16);
		// A phone-width canvas at scale 0.35 would render 16 units as 5.6px.
		expect(legibleFontSize(16, 12, 0.35)).toBeCloseTo(34.29, 2);
	});
});

describe("snapping and rotation", () => {
	it("snaps to the grid", () => {
		expect(snapValue(14)).toBe(10);
		expect(snapValue(15)).toBe(20);
		expect(snapValue(-4)).toBe(-0);
	});

	it("normalises rotation like the backend", () => {
		expect(normalizeRotation(450)).toBe(90);
		expect(normalizeRotation(-90)).toBe(270);
		expect(normalizeRotation(360)).toBe(0);
		expect(normalizeRotation(Number.NaN)).toBe(0);
	});

	it("snaps angles to 15 degree steps", () => {
		expect(snapAngle(52)).toBe(45);
		expect(snapAngle(353)).toBe(0);
	});
});

describe("clampBox", () => {
	it("keeps the box inside the canvas and above the minimum size", () => {
		expect(clampBox(box({ x: -20, y: 690, width: 80, height: 80 }))).toMatchObject({ x: 0, y: 620 });
		expect(clampBox(box({ width: 2, height: 2000 }))).toMatchObject({
			width: MIN_BOX_SIZE,
			height: CANVAS_HEIGHT,
			y: 0,
		});
	});

	it("preserves extra fields such as labels", () => {
		expect(clampBox({ ...box(), table_label: "T1" }).table_label).toBe("T1");
	});
});

describe("moveBox", () => {
	it("moves, optionally snaps, and clamps", () => {
		expect(moveBox(box(), 13, 7)).toMatchObject({ x: 113, y: 107 });
		expect(moveBox(box(), 13, 7, true)).toMatchObject({ x: 110, y: 110 });
		expect(moveBox(box(), 5000, 0)).toMatchObject({ x: CANVAS_WIDTH - 80 });
	});
});

describe("resizeBox", () => {
	it("keeps the opposite edge fixed for an unrotated box", () => {
		const resized = resizeBox(box(), "se", { x: 220, y: 250 });
		expect(resized).toMatchObject({ x: 100, y: 100, width: 120, height: 150 });

		const fromWest = resizeBox(box(), "w", { x: 60, y: 0 });
		expect(fromWest).toMatchObject({ x: 60, width: 120, y: 100, height: 80 });
	});

	it("snaps the size and enforces the minimum", () => {
		expect(resizeBox(box(), "e", { x: 213, y: 0 }, true).width).toBe(110);
		expect(resizeBox(box(), "e", { x: 50, y: 0 }).width).toBe(MIN_BOX_SIZE);
	});

	it("resizes along the box's own axes when rotated", () => {
		// Rotated 90 degrees, the box's local east edge points down the screen.
		const rotated = box({ x: 100, y: 100, width: 80, height: 80, rotation: 90 });
		const resized = resizeBox(rotated, "e", { x: 140, y: 220 });
		expect(resized.width).toBeCloseTo(120, 6);
		expect(resized.height).toBeCloseTo(80, 6);
		// The local west edge (screen top, y = 100) stays put.
		expect(resized.y + resized.height / 2 - resized.width / 2).toBeCloseTo(100, 6);
	});
});

describe("rotationFromPointer", () => {
	it("treats straight up as 0 degrees and turns clockwise", () => {
		const centered = box({ x: 100, y: 100, width: 100, height: 100 });
		expect(rotationFromPointer(centered, { x: 150, y: 0 })).toBeCloseTo(0, 6);
		expect(rotationFromPointer(centered, { x: 300, y: 150 })).toBeCloseTo(90, 6);
		expect(rotationFromPointer(centered, { x: 0, y: 150 })).toBeCloseTo(270, 6);
		expect(rotationFromPointer(centered, { x: 300, y: 10 }, true)).toBe(45);
	});
});

describe("tableTextLayout", () => {
	const table = (values: Partial<{ table_label: string; seats: number; shape: string; width: number; height: number }> = {}) => ({
		table_label: "T1",
		seats: 4,
		shape: "Square",
		width: 80,
		height: 80,
		...values,
	});
	// At 320px wide, the canvas is about 286px across: a scale of roughly 0.286.
	const PHONE_SCALE = 286 / 1000;

	it("shows the label and seat count when there is room", () => {
		const layout = tableTextLayout(table(), "4 seats", 1.2);
		expect(layout.label).toBe("T1");
		expect(layout.seatsSize).not.toBeNull();
		expect(layout.labelDy).toBeLessThan(0);
		expect(layout.seatsDy).toBeGreaterThan(0);
	});

	it("hides the seat count on a 320px screen but keeps the label inside the table", () => {
		const t = table();
		const layout = tableTextLayout(t, "4 seats", PHONE_SCALE);
		expect(layout.seatsSize).toBeNull();
		expect(layout.labelDy).toBe(0);
		expect(layout.label.length * 0.62 * layout.labelSize).toBeLessThanOrEqual(t.width);
		expect(layout.labelSize).toBeLessThanOrEqual(t.height);
	});

	it("shrinks a long label to fit instead of overflowing", () => {
		const t = table({ table_label: "Window 12" });
		const layout = tableTextLayout(t, "4 seats", 1);
		expect(layout.label).toBe("Window 12");
		expect(layout.labelSize).toBeLessThan(22);
		expect(layout.label.length * 0.62 * layout.labelSize).toBeLessThanOrEqual(t.width * 0.86 + 1e-9);
		// Shrunk below its preferred size, so the seat count makes way for it.
		expect(layout.seatsSize).toBeNull();
	});

	it("truncates a long label on a 320px screen rather than spilling out", () => {
		const t = table({ table_label: "Window 12" });
		const layout = tableTextLayout(t, "4 seats", PHONE_SCALE);
		expect(layout.label.endsWith("…")).toBe(true);
		expect(layout.label.length * 0.62 * layout.labelSize).toBeLessThanOrEqual(t.width * 0.86 + 1e-9);
	});

	it("truncates only when the label would fall below the hard minimum", () => {
		const layout = tableTextLayout(table({ table_label: "Private Dining Room", width: 40, height: 40 }), "4 seats", PHONE_SCALE);
		expect(layout.label.endsWith("…")).toBe(true);
		expect(layout.label.length).toBeLessThan("Private Dining Room".length);
		expect(layout.seatsSize).toBeNull();
	});

	// A 768px tablet in portrait leaves a canvas about 710px wide.
	const TABLET_SCALE = 710 / 1000;

	it("shows the seat count on a default round table on desktop and tablet", () => {
		for (const scale of [1, TABLET_SCALE]) {
			const t = table({ shape: "Round" });
			const layout = tableTextLayout(t, "4 seats", scale);
			expect(layout.seatsSize, `scale ${scale}`).not.toBeNull();
			// Readable on screen, and within the circle's inscribed width.
			expect(layout.seatsSize! * scale).toBeGreaterThanOrEqual(10 - 1e-9);
			expect("4 seats".length * 0.55 * layout.seatsSize!).toBeLessThanOrEqual(t.width * 0.7 + 1e-9);
			expect(layout.labelSize + layout.seatsSize!).toBeLessThanOrEqual(t.height * 0.7);
		}
	});

	it("shows the seat count on a default square table on tablet", () => {
		expect(tableTextLayout(table(), "4 seats", TABLET_SCALE).seatsSize).not.toBeNull();
	});

	it("still hides the seat count of a default round table on a 320px screen", () => {
		const t = table({ shape: "Round" });
		const layout = tableTextLayout(t, "4 seats", PHONE_SCALE);
		expect(layout.seatsSize).toBeNull();
		expect(layout.label.length * 0.62 * layout.labelSize).toBeLessThanOrEqual(t.width * 0.7 + 1e-9);
	});

	it("uses the smaller inscribed area of round tables", () => {
		const square = tableTextLayout(table({ table_label: "Terrace 4" }), "4 seats", 1);
		const round = tableTextLayout(table({ table_label: "Terrace 4", shape: "Round" }), "4 seats", 1);
		expect(round.labelSize).toBeLessThan(square.labelSize);
	});
});
