type ScanKey = Pick<
  KeyboardEvent,
  | "key"
  | "timeStamp"
  | "ctrlKey"
  | "altKey"
  | "metaKey"
  | "isComposing"
  | "repeat"
>;

// Conservative keyboard-wedge detection. Slow/configured-delay scanners can
// still use the focused search field, which does not impose timing limits.
const MAX_KEY_GAP_MS = 80;
const MAX_AVERAGE_KEY_MS = 40;
const MIN_BARCODE_LENGTH = 4;
const MAX_BARCODE_LENGTH = 256;

/** Serialize lookups; cancelling drops queued scans, not an in-flight request. */
export function createScanQueue(
  onScan: (barcode: string) => void | Promise<void>
) {
  let pending = Promise.resolve();
  let generation = 0;
  return {
    enqueue(barcode: string) {
      const acceptedIn = generation;
      pending = pending
        .then(async () => {
          if (acceptedIn === generation) await onScan(barcode);
        })
        .catch(() => undefined);
      return pending;
    },
    cancel() {
      generation += 1;
    },
  };
}

export function createKeyboardScanDetector() {
  let buffer = "";
  let firstAt = 0;
  let lastAt = 0;
  let overflow = false;
  const reset = () => {
    buffer = "";
    firstAt = 0;
    lastAt = 0;
    overflow = false;
  };
  return {
    reset,
    feed(event: ScanKey): string | null {
      if (
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        event.repeat
      ) {
        reset();
        return null;
      }
      if (event.key === "Shift") return null;
      const now = event.timeStamp;
      if (now < lastAt || now - lastAt > MAX_KEY_GAP_MS) reset();
      if (event.key === "Enter") {
        const value = buffer.trim();
        const scanned =
          !overflow &&
          value.length >= MIN_BARCODE_LENGTH &&
          (now - firstAt) / buffer.length <= MAX_AVERAGE_KEY_MS;
        reset();
        return scanned ? value : null;
      }
      if (event.key.length !== 1) {
        reset();
        return null;
      }
      if (!buffer) firstAt = now;
      lastAt = now;
      if (buffer.length >= MAX_BARCODE_LENGTH) overflow = true;
      if (!overflow) buffer += event.key;
      return null;
    },
  };
}

export function isScannerEditableTarget(target: EventTarget | null) {
  const element = target as Element | null;
  return Boolean(
    element &&
      typeof element.closest === "function" &&
      element.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='spinbutton']"
      )
  );
}

/** Capture Enter before a previously focused item/action button can activate. */
export function subscribeHardwareScanner(
  source: Pick<Window, "addEventListener" | "removeEventListener">,
  onScan: (barcode: string) => void,
  isBlocked: (event: KeyboardEvent) => boolean
) {
  const detector = createKeyboardScanDetector();
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isBlocked(event)) {
      detector.reset();
      return;
    }
    const barcode = detector.feed(event);
    if (!barcode) return;
    event.preventDefault();
    event.stopPropagation();
    onScan(barcode);
  };
  source.addEventListener("keydown", keydown, true);
  source.addEventListener("blur", detector.reset, true);
  source.addEventListener("focusin", detector.reset, true);
  return () => {
    detector.reset();
    source.removeEventListener("keydown", keydown, true);
    source.removeEventListener("blur", detector.reset, true);
    source.removeEventListener("focusin", detector.reset, true);
  };
}
