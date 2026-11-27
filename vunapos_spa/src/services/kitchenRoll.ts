const ROLL_WIDTH_MM = 80;
const PX_PER_MM = 96 / 25.4;

export function kitchenRollHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Print formats are documents, not executable pages.
  doc.querySelectorAll("script").forEach((script) => script.remove());
  // QZ renders HTML without the browser's print-media lifecycle.
  doc
    .querySelectorAll(".action-banner, .print-hide")
    .forEach((element) => element.remove());
  const style = doc.createElement("style");
  style.textContent = `
    @page { size: auto; margin: 0; }
    html, body { width: 80mm !important; height: auto !important;
      min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
    .print-format-gutter { background: transparent !important; padding: 0 !important; }
    .print-format { min-height: 0 !important; height: auto !important;
      max-width: 80mm !important; box-sizing: border-box; }
    .print-format .page-break { border-bottom: 0 !important; }
  `;
  doc.head.append(style);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

/** Measure the same roll HTML sent to QZ, not Frappe's A4 preview canvas. */
export function measureKitchenRoll(html: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:80mm;height:1px;border:0;visibility:hidden";
    const timer = window.setTimeout(() => {
      frame.remove();
      reject(
        new Error(
          "Unable to measure kitchen ticket. Check print format resources."
        )
      );
    }, 10000);
    frame.onload = async () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) throw new Error("Unable to measure kitchen ticket.");
        await doc.fonts?.ready;
        await Promise.all(
          Array.from(doc.images, (image) =>
            image.decode().catch(() => undefined)
          )
        );
        const pixels = Math.max(
          doc.body.scrollHeight,
          doc.body.getBoundingClientRect().height
        );
        if (!Number.isFinite(pixels) || pixels <= 0)
          throw new Error("Kitchen ticket has no printable content.");
        // Two millimetres protect the final line from browser/Java font rounding.
        resolve(Math.ceil(pixels / PX_PER_MM) + 2);
      } catch (error) {
        reject(error);
      } finally {
        window.clearTimeout(timer);
        frame.remove();
      }
    };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}

export function kitchenRollConfig(height: number) {
  if (!Number.isFinite(height) || height <= 0)
    throw new Error("Invalid kitchen ticket height.");
  return {
    jobName: "Kitchen Order Ticket",
    copies: 1,
    units: "mm",
    margins: 0,
    scaleContent: false,
    orientation: "portrait",
    size: { width: ROLL_WIDTH_MM, height, custom: true },
  };
}
