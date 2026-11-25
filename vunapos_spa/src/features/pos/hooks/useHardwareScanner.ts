import { useCallback, useEffect, useRef } from "react";
import {
  createScanQueue,
  isScannerEditableTarget,
  subscribeHardwareScanner,
} from "../../../lib/keyboardScanner";

/** Mounted only with the selling search. Never focuses an input or keyboard. */
export function useHardwareScanner(
  onScan: (barcode: string) => void | Promise<void>,
  enabled = true
) {
  const handler = useRef(onScan);
  const active = useRef(false);
  const queue = useRef<ReturnType<typeof createScanQueue> | null>(null);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  // Keep rapid scans in order, even when barcode lookup takes a round trip.
  // The existing scan handler owns user-facing errors; a failure must not
  // prevent later scans from being processed.
  const scan = useCallback((barcode: string) => {
    if (active.current) void queue.current?.enqueue(barcode);
  }, []);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) return;
    const currentQueue =
      queue.current ?? createScanQueue((barcode) => handler.current(barcode));
    queue.current = currentQueue;
    const unsubscribe = subscribeHardwareScanner(
      window,
      scan,
      (event) =>
        document.visibilityState === "hidden" ||
        Boolean(
          document.querySelector(
            '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]'
          )
        ) ||
        isScannerEditableTarget(event.composedPath()[0] || event.target) ||
        isScannerEditableTarget(document.activeElement)
    );
    return () => {
      active.current = false;
      currentQueue.cancel();
      unsubscribe();
    };
  }, [scan, enabled]);

  return scan;
}
