import { describe, expect, it, vi } from "vitest";
import {
  createKeyboardScanDetector,
  createScanQueue,
  isScannerEditableTarget,
  subscribeHardwareScanner,
} from "../keyboardScanner";

function key(
  value: string,
  time: number,
  overrides: Partial<KeyboardEvent> = {}
) {
  return {
    key: value,
    timeStamp: time,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function scan(
  detector: ReturnType<typeof createKeyboardScanDetector>,
  value: string,
  start = 100,
  gap = 8
) {
  for (const [index, character] of [...value].entries())
    expect(detector.feed(key(character, start + index * gap))).toBeNull();
  return detector.feed(key("Enter", start + value.length * gap));
}

describe("keyboard-wedge barcode detection", () => {
  it("accepts rapid numeric and alphanumeric barcodes terminated by Enter", () => {
    expect(scan(createKeyboardScanDetector(), "0012345678901")).toBe(
      "0012345678901"
    );
    expect(scan(createKeyboardScanDetector(), "BOX-0001")).toBe("BOX-0001");
  });

  it("does not treat ordinary typing, a delayed Enter or short text as a scan", () => {
    expect(scan(createKeyboardScanDetector(), "hello", 100, 110)).toBeNull();
    expect(scan(createKeyboardScanDetector(), "hello", 100, 50)).toBeNull();
    expect(scan(createKeyboardScanDetector(), "123")).toBeNull();
    const detector = createKeyboardScanDetector();
    for (let i = 0; i < 8; i++) detector.feed(key("1", 100 + i * 8));
    expect(detector.feed(key("Enter", 600))).toBeNull();
  });

  it("resets stale text before the next scan and does not replay Enter", () => {
    const detector = createKeyboardScanDetector();
    detector.feed(key("a", 100));
    expect(scan(detector, "12345678", 500)).toBe("12345678");
    expect(detector.feed(key("Enter", 600))).toBeNull();
    expect(scan(detector, "12345678", 610)).toBe("12345678");
  });

  it("supports shifted characters without including Shift in the barcode", () => {
    const detector = createKeyboardScanDetector();
    detector.feed(key("Shift", 100));
    expect(scan(detector, "ABCD-123", 105)).toBe("ABCD-123");
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { repeat: true },
    { isComposing: true },
  ])("ignores modified or composing input: %j", (flags) => {
    const detector = createKeyboardScanDetector();
    for (let i = 0; i < 8; i++) detector.feed(key("1", 100 + i * 8, flags));
    expect(detector.feed(key("Enter", 170))).toBeNull();
  });

  it("rejects oversized input rather than scanning its truncated tail", () => {
    expect(scan(createKeyboardScanDetector(), "1".repeat(300))).toBeNull();
  });

  it("clears an incomplete scan on reset or navigation keys", () => {
    const detector = createKeyboardScanDetector();
    for (let i = 0; i < 4; i++) detector.feed(key("1", 100 + i * 8));
    detector.feed(key("Tab", 135));
    expect(detector.feed(key("Enter", 140))).toBeNull();
    detector.reset();
    expect(scan(detector, "12345678", 150)).toBe("12345678");
  });
});

describe("selling-screen scanner subscription", () => {
  function fixture() {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const source = {
      addEventListener: vi.fn(
        (name: string, listener: (event: KeyboardEvent) => void) =>
          listeners.set(name, listener)
      ),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    };
    let blocked = false;
    const onScan = vi.fn();
    const leave = subscribeHardwareScanner(
      source as unknown as Window,
      onScan,
      () => blocked
    );
    const deliver = (event: KeyboardEvent) => listeners.get("keydown")?.(event);
    const input = (value: string, start = 100) => {
      [...value].forEach((character, index) =>
        deliver(key(character, start + index * 8))
      );
      const enter = key("Enter", start + value.length * 8);
      deliver(enter);
      return enter;
    };
    return {
      listeners,
      source,
      onScan,
      leave,
      deliver,
      input,
      setBlocked: (value: boolean) => {
        blocked = value;
      },
    };
  }

  it("captures scanner Enter to prevent a focused action button being clicked", () => {
    const current = fixture();
    const enter = current.input("0012345678901");
    expect(current.onScan).toHaveBeenCalledExactlyOnceWith("0012345678901");
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(enter.stopPropagation).toHaveBeenCalledOnce();
    expect(current.source.addEventListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true
    );
  });

  it("does not intercept scans in blocked inputs or dialogs, or replay them afterwards", () => {
    const current = fixture();
    current.setBlocked(true);
    expect(current.input("12345678").preventDefault).not.toHaveBeenCalled();
    expect(current.onScan).not.toHaveBeenCalled();
    current.setBlocked(false);
    current.deliver(key("Enter", 200));
    expect(current.onScan).not.toHaveBeenCalled();
    current.input("12345678", 300);
    expect(current.onScan).toHaveBeenCalledTimes(1);
  });

  it("does not interfere with normal Enter and removes only its own listeners", () => {
    const current = fixture();
    const enter = key("Enter", 100);
    current.deliver(enter);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    current.leave();
    expect(current.listeners.size).toBe(0);
    expect(current.source.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it("discards partial scans when the window loses focus", () => {
    const current = fixture();
    "12345678"
      .split("")
      .forEach((character, index) =>
        current.deliver(key(character, 100 + index * 8))
      );
    current.listeners.get("blur")?.(key("", 165));
    current.deliver(key("Enter", 170));
    expect(current.onScan).not.toHaveBeenCalled();
  });

  it("protects editable fields and custom text editors", () => {
    const closest = vi.fn<(selector: string) => object>(() => ({}));
    expect(isScannerEditableTarget({ closest } as unknown as EventTarget)).toBe(
      true
    );
    expect(closest.mock.calls[0][0]).toContain("input, textarea, select");
    expect(closest.mock.calls[0][0]).toContain("contenteditable");
    expect(isScannerEditableTarget(null)).toBe(false);
    expect(
      isScannerEditableTarget({ closest: () => null } as unknown as EventTarget)
    ).toBe(false);
  });
});

describe("consecutive scan queue", () => {
  it("waits for an item lookup before handling the next scan", async () => {
    let finish: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const handler = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(undefined);
    const queue = createScanQueue(handler);
    void queue.enqueue("first");
    const second = queue.enqueue("second");
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    finish();
    await second;
    expect(handler.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("carries on after a failed scan", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unknown item"))
      .mockResolvedValue(undefined);
    const queue = createScanQueue(handler);
    void queue.enqueue("unknown");
    await queue.enqueue("known");
    expect(handler.mock.calls).toEqual([["unknown"], ["known"]]);
  });

  it("drops queued scans on leaving or disabling POS without poisoning future scans", async () => {
    const handler = vi.fn();
    const queue = createScanQueue(handler);
    void queue.enqueue("old page");
    queue.cancel();
    await queue.enqueue("new page");
    expect(handler).toHaveBeenCalledExactlyOnceWith("new page");
  });
});
