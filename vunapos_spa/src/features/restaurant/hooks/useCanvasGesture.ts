import { useCallback, useRef, type PointerEvent, type RefObject } from "react";

import type { ItemPatch, Selection } from "../floorPlanDraft";
import {
	fitCanvas,
	moveBox,
	resizeBox,
	rotationFromPointer,
	screenToCanvas,
	type Box,
	type Point,
	type ResizeHandle,
} from "../floorPlanGeometry";

// Below this on-screen distance a press is a tap (select), not a drag.
const DRAG_THRESHOLD_PX = 3;

type Gesture = {
	pointerId: number;
	kind: "move" | "resize" | "rotate";
	handle?: ResizeHandle;
	selection: Selection;
	startPoint: Point;
	startBox: Box;
	moved: boolean;
};

type GestureOptions = {
	snap: boolean;
	disabled?: boolean;
	onChange: (selection: Selection, patch: ItemPatch) => void;
};

// Drag, resize and rotate with pointer events, so mouse, trackpad and touch share
// one path. Only one pointer drives a gesture; a second finger is ignored.
export function useCanvasGesture(svgRef: RefObject<SVGSVGElement | null>, { snap, disabled, onChange }: GestureOptions) {
	const gestureRef = useRef<Gesture | null>(null);

	const toCanvas = useCallback(
		(event: PointerEvent<Element>) => {
			const rect = svgRef.current?.getBoundingClientRect();
			return rect ? screenToCanvas(event.clientX, event.clientY, rect) : { x: 0, y: 0 };
		},
		[svgRef],
	);

	const begin = useCallback(
		(event: PointerEvent<Element>, kind: Gesture["kind"], selection: Selection, box: Box, handle?: ResizeHandle) => {
			if (disabled || gestureRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
			event.stopPropagation();
			svgRef.current?.setPointerCapture(event.pointerId);
			gestureRef.current = {
				pointerId: event.pointerId,
				kind,
				handle,
				selection,
				startPoint: toCanvas(event),
				startBox: { x: box.x, y: box.y, width: box.width, height: box.height, rotation: box.rotation },
				moved: false,
			};
		},
		[disabled, svgRef, toCanvas],
	);

	const onPointerMove = useCallback(
		(event: PointerEvent<SVGSVGElement>) => {
			const gesture = gestureRef.current;
			if (!gesture || event.pointerId !== gesture.pointerId) return;
			const point = toCanvas(event);
			const dx = point.x - gesture.startPoint.x;
			const dy = point.y - gesture.startPoint.y;
			if (!gesture.moved) {
				const rect = event.currentTarget.getBoundingClientRect();
				const { scale } = fitCanvas(rect.width, rect.height);
				if (Math.hypot(dx, dy) * scale < DRAG_THRESHOLD_PX) return;
				gesture.moved = true;
			}
			if (gesture.kind === "move") {
				const box = moveBox(gesture.startBox, dx, dy, snap);
				onChange(gesture.selection, { x: box.x, y: box.y });
			} else if (gesture.kind === "resize" && gesture.handle) {
				const box = resizeBox(gesture.startBox, gesture.handle, point, snap);
				onChange(gesture.selection, { x: box.x, y: box.y, width: box.width, height: box.height });
			} else if (gesture.kind === "rotate") {
				onChange(gesture.selection, { rotation: rotationFromPointer(gesture.startBox, point, snap) });
			}
		},
		[onChange, snap, toCanvas],
	);

	const end = useCallback((event: PointerEvent<SVGSVGElement>) => {
		const gesture = gestureRef.current;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		gestureRef.current = null;
	}, []);

	return { begin, onPointerMove, onPointerUp: end, onPointerCancel: end };
}
