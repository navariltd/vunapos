import { usePrintFeedbackStore } from "./stores/printFeedbackStore";

// Prints a rendered print format through a hidden iframe, so the page itself stays put.
export function printHtml(html: string) {
  const finish = usePrintFeedbackStore.getState().begin();
  let removeFrame: (() => void) | undefined;
  try {
    const printFrame = document.createElement("iframe");
    removeFrame = () => printFrame.remove();
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    printFrame.setAttribute("aria-hidden", "true");
    document.body.appendChild(printFrame);

    const printDocument = printFrame.contentWindow?.document;
    if (!printDocument) {
      throw new Error("The print frame could not be opened.");
    }

    printDocument.open();
    printDocument.write(html);
    printDocument.close();

    // Images (a company logo) must load first or they print blank; never wait long.
    const images = Array.from(printDocument.images).filter(
      (image) => !image.complete
    );
    const loaded = Promise.all(
      images.map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          })
      )
    );
    let timeoutId: number;
    const timeout = new Promise((resolve) => {
      timeoutId = window.setTimeout(resolve, 3000);
    });
    void Promise.race([loaded, timeout])
      .then(() => {
        window.clearTimeout(timeoutId);
        window.setTimeout(() => {
          try {
            printFrame.contentWindow?.focus();
            if (!printFrame.contentWindow)
              throw new Error("The print frame was closed.");
            printFrame.contentWindow.print();
            window.setTimeout(() => printFrame.remove(), 1000);
          } catch {
            printFrame.remove();
            usePrintFeedbackStore.getState().fail();
          } finally {
            finish();
          }
        }, 100);
      })
      .catch(() => {
        window.clearTimeout(timeoutId);
        printFrame.remove();
        usePrintFeedbackStore.getState().fail();
        finish();
      });
  } catch {
    removeFrame?.();
    usePrintFeedbackStore.getState().fail();
    finish();
  }
}
