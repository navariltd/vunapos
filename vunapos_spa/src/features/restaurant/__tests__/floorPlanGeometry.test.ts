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
