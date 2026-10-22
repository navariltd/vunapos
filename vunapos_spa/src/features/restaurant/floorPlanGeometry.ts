// Pure geometry for the floor plan canvas: no React, DOM or store access.
// Every position and size is in virtual canvas units (see docs/restaurant-pos-design.md).

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 700;
export const GRID_SIZE = 10;
export const ROTATION_STEP = 15;
export const MIN_BOX_SIZE = 10;

export type Point = { x: number; y: number };

export type Box = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
};

export type CanvasFit = {
	// Screen pixels per canvas unit.
	scale: number;
	// Letterbox offsets inside the container, in screen pixels.
	offsetX: number;
	offsetY: number;
};

export type ScreenRect = { left: number; top: number; width: number; height: number };

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Mirrors SVG preserveAspectRatio="xMidYMid meet" for a 1000 x 700 viewBox.
export function fitCanvas(containerWidth: number, containerHeight: number): CanvasFit {
	if (containerWidth <= 0 || containerHeight <= 0) return { scale: 0, offsetX: 0, offsetY: 0 };
	const scale = Math.min(containerWidth / CANVAS_WIDTH, containerHeight / CANVAS_HEIGHT);
	return {
		scale,
		offsetX: (containerWidth - CANVAS_WIDTH * scale) / 2,
		offsetY: (containerHeight - CANVAS_HEIGHT * scale) / 2,
	};
}

export function screenToCanvas(clientX: number, clientY: number, rect: ScreenRect): Point {
	const { scale, offsetX, offsetY } = fitCanvas(rect.width, rect.height);
	if (!scale) return { x: 0, y: 0 };
	return {
		x: (clientX - rect.left - offsetX) / scale,
		y: (clientY - rect.top - offsetY) / scale,
	};
}

// A canvas length that renders as `screenPx` on screen, e.g. for handles.
export function screenPxToCanvas(screenPx: number, scale: number): number {
	return scale > 0 ? screenPx / scale : screenPx;
}

// Font size in canvas units that never renders smaller than `minScreenPx`, so
// labels stay readable when the canvas is scaled down on a phone.
export function legibleFontSize(baseUnits: number, minScreenPx: number, scale: number): number {
	return Math.max(baseUnits, screenPxToCanvas(minScreenPx, scale));
}

export function snapValue(value: number, grid = GRID_SIZE): number {
	return Math.round(value / grid) * grid;
}

// Same result as the backend's `flt(value) % 360` for any finite input.
export function normalizeRotation(degrees: number): number {
	if (!Number.isFinite(degrees)) return 0;
	const normalized = ((degrees % 360) + 360) % 360;
	return normalized === 360 ? 0 : normalized;
}

export function snapAngle(degrees: number, step = ROTATION_STEP): number {
	return normalizeRotation(Math.round(degrees / step) * step);
}

// Keeps the unrotated box inside the canvas, which is the backend's rule.
export function clampBox<T extends Box>(box: T): T {
	const width = Math.min(Math.max(box.width, MIN_BOX_SIZE), CANVAS_WIDTH);
	const height = Math.min(Math.max(box.height, MIN_BOX_SIZE), CANVAS_HEIGHT);
	return {
		...box,
		width,
		height,
		x: Math.min(Math.max(box.x, 0), CANVAS_WIDTH - width),
		y: Math.min(Math.max(box.y, 0), CANVAS_HEIGHT - height),
		rotation: normalizeRotation(box.rotation),
	};
}

export function moveBox<T extends Box>(box: T, dx: number, dy: number, snap = false): T {
	const x = box.x + dx;
	const y = box.y + dy;
	return clampBox({ ...box, x: snap ? snapValue(x) : x, y: snap ? snapValue(y) : y });
}

function rotatePoint(point: Point, degrees: number): Point {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export function boxCenter(box: Box): Point {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Resizes in the box's own (rotated) axes, keeping the opposite edges fixed.
export function resizeBox<T extends Box>(box: T, handle: ResizeHandle, pointer: Point, snap = false): T {
	const center = boxCenter(box);
	const local = rotatePoint({ x: pointer.x - center.x, y: pointer.y - center.y }, -box.rotation);
	let left = -box.width / 2;
	let right = box.width / 2;
	let top = -box.height / 2;
	let bottom = box.height / 2;

	const fit = (moving: number, fixed: number, direction: 1 | -1) => {
		let size = Math.max((moving - fixed) * direction, MIN_BOX_SIZE);
		if (snap) size = Math.max(snapValue(size), MIN_BOX_SIZE);
		return fixed + size * direction;
	};
	if (handle.includes("e")) right = fit(local.x, left, 1);
	if (handle.includes("w")) left = fit(local.x, right, -1);
	if (handle.includes("s")) bottom = fit(local.y, top, 1);
	if (handle.includes("n")) top = fit(local.y, bottom, -1);

	const width = right - left;
	const height = bottom - top;
	const shift = rotatePoint({ x: (left + right) / 2, y: (top + bottom) / 2 }, box.rotation);
	return clampBox({
		...box,
		width,
		height,
		x: center.x + shift.x - width / 2,
		y: center.y + shift.y - height / 2,
	});
}

// The rotate handle sits above the box, so pointing straight up is 0 degrees.
export function rotationFromPointer(box: Box, pointer: Point, snap = false): number {
	const center = boxCenter(box);
	const degrees = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
	return snap ? snapAngle(degrees) : normalizeRotation(degrees);
}
