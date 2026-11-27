// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kitchenRollConfig,
  kitchenRollHtml,
  measureKitchenRoll,
} from "../kitchenRoll";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("kitchen roll sizing", () => {
  it("excludes Desk preview controls and screen-only content from paper", () => {
    const html = kitchenRollHtml(
      '<div class="action-banner print-hide"><a>Print</a><a>Get PDF</a></div><div class="print-hide">Preview only</div><div class="print-format">KOT-1: Tea</div>'
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toBe("KOT-1: Tea");
    expect(doc.querySelector(".action-banner, .print-hide")).toBeNull();
  });
  it("removes A4 preview minimum height and gutter without replacing ticket content", () => {
    const html = kitchenRollHtml(
      '<html><head><style>.print-format {min-height:11.69in}</style></head><body><div class="print-format-gutter"><div class="print-format">Tea × 2</div></div><script>print()</script></body></html>'
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector(".print-format")?.textContent).toBe("Tea × 2");
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.head.lastElementChild?.textContent).toContain(
      "min-height: 0 !important"
    );
    expect(doc.head.lastElementChild?.textContent).toContain(
      "padding: 0 !important"
    );
  });

  it("requests a custom paper length matching each ticket, not the driver default", () => {
    expect(kitchenRollConfig(57)).toMatchObject({
      units: "mm",
      scaleContent: false,
      margins: 0,
      size: { width: 80, height: 57, custom: true },
    });
    expect(kitchenRollConfig(410).size.height).toBe(410);
  });

  it("does not silently print on an invalid measurement", () => {
    for (const height of [NaN, Infinity, 0, -1]) {
      expect(() => kitchenRollConfig(height)).toThrow(
        "Invalid kitchen ticket height"
      );
    }
  });

  it("measures content height, adds a small cut allowance, and removes its frame", async () => {
    const pending = measureKitchenRoll(kitchenRollHtml("<p>Tea</p>"));
    const frame = document.querySelector("iframe")!;
    Object.defineProperty(frame.contentDocument!.body, "scrollHeight", {
      value: 96,
    });
    frame.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBe(28);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("cleans up and fails instead of printing an unmeasured driver-sized page", async () => {
    vi.useFakeTimers();
    // Simulate an iframe that never finishes loading its resources.
    vi.spyOn(document.body, "append").mockImplementation(() => {});
    const pending = measureKitchenRoll("<p>Tea</p>");
    const rejected = expect(pending).rejects.toThrow(
      "Unable to measure kitchen ticket"
    );
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(document.querySelector("iframe")).toBeNull();
  });
});
