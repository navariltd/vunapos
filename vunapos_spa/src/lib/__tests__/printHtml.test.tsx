import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { printHtml } from "../printHtml";
import { usePrintFeedbackStore } from "../stores/printFeedbackStore";
import { PrintFeedback } from "../../components/PrintFeedback";

vi.mock("../stores/printFeedbackStore", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../stores/printFeedbackStore")
  >();
  const hook = Object.assign(
    (
      select: (
        state: ReturnType<typeof actual.usePrintFeedbackStore.getState>
      ) => unknown
    ) => select(actual.usePrintFeedbackStore.getState()),
    actual.usePrintFeedbackStore
  );
  return { ...actual, usePrintFeedbackStore: hook };
});

describe("receipt print feedback", () => {
  function environment(
    images: Array<EventTarget & { complete: boolean }> = []
  ) {
    const content = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn(), images },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const frame = {
      style: {},
      setAttribute: vi.fn(),
      contentWindow: content,
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => frame),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    return { content, frame };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    usePrintFeedbackStore.setState({ pending: 0, error: null });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    usePrintFeedbackStore.setState({ pending: 0, error: null });
  });

  it("shows a spinner until the print dialog is requested, without claiming paper was printed", async () => {
    const { content, frame } = environment();
    printHtml("<p>Receipt</p>");
    expect(usePrintFeedbackStore.getState().pending).toBe(1);
    const progress = renderToStaticMarkup(<PrintFeedback />);
    expect(progress).toContain("Opening print dialog…");
    expect(progress).toContain('role="dialog"');
    expect(progress).toContain('aria-modal="true"');
    expect(progress).toContain('tabindex="-1"');
    expect(progress).toContain("fixed inset-0");
    expect(progress).toContain("bg-surface/70");
    expect(progress).not.toMatch(/\bbg-surface(?:\s|")/);
    expect(progress).toContain("size-12");
    expect(progress).not.toContain("bottom-24");
    expect(content.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(content.document.write).toHaveBeenCalledWith("<p>Receipt</p>");
    expect(content.print).toHaveBeenCalledOnce();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
    expect(renderToStaticMarkup(<PrintFeedback />)).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the indicator visible while the receipt logo loads", async () => {
    const image = Object.assign(new EventTarget(), { complete: false });
    const { content } = environment([image]);
    printHtml("Receipt with logo");
    await vi.advanceTimersByTimeAsync(500);
    expect(content.print).not.toHaveBeenCalled();
    expect(usePrintFeedbackStore.getState().pending).toBe(1);
    image.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(100);
    expect(content.print).toHaveBeenCalledOnce();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
  });

  it("does not wait forever for an unavailable image", async () => {
    const image = Object.assign(new EventTarget(), { complete: false });
    const { content } = environment([image]);
    printHtml("Receipt with unavailable logo");
    await vi.advanceTimersByTimeAsync(3100);
    expect(content.print).toHaveBeenCalledOnce();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
  });

  it("clears progress and shows a printing-only error if the browser refuses to print", async () => {
    const { content, frame } = environment();
    content.print.mockImplementation(() => {
      throw new Error("Printing blocked");
    });
    printHtml("Receipt");
    await vi.advanceTimersByTimeAsync(100);
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
    const html = renderToStaticMarkup(<PrintFeedback />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("do not complete the sale again");
    usePrintFeedbackStore.getState().clearError();
    expect(renderToStaticMarkup(<PrintFeedback />)).toBe("");
  });

  it("does not leave a stuck spinner when the print frame cannot be created", () => {
    const { frame } = environment();
    Object.defineProperty(frame, "contentWindow", { value: null });
    printHtml("Receipt");
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
    expect(usePrintFeedbackStore.getState().error).not.toBeNull();
  });

  it("does not hide another pending print or count a completion twice", () => {
    const first = usePrintFeedbackStore.getState().begin();
    const second = usePrintFeedbackStore.getState().begin();
    first();
    first();
    expect(usePrintFeedbackStore.getState().pending).toBe(1);
    second();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
  });

  it("clears progress if the browser refuses to create the print frame", () => {
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("Frame creation blocked");
      },
    });
    expect(() => printHtml("Receipt")).not.toThrow();
    expect(usePrintFeedbackStore.getState().pending).toBe(0);
    expect(usePrintFeedbackStore.getState().error).not.toBeNull();
  });
});
