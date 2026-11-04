import { useEffect, useState, type RefObject } from "react";

import { fitCanvas, type CanvasFit } from "../floorPlanGeometry";

// Tracks how the 1000 x 700 canvas is currently scaled inside its container.
export function useCanvasScale(containerRef: RefObject<Element | null>): CanvasFit {
	const [fit, setFit] = useState<CanvasFit>({ scale: 0, offsetX: 0, offsetY: 0 });

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setFit(fitCanvas(width, height));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [containerRef]);

	return fit;
}
