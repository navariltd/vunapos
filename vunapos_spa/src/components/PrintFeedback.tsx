import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { usePrintFeedbackStore } from "../lib/stores/printFeedbackStore";

export function PrintFeedback() {
  const pending = usePrintFeedbackStore((state) => state.pending);
  const error = usePrintFeedbackStore((state) => state.error);
  const clearError = usePrintFeedbackStore((state) => state.clearError);
  if (pending) return <PrintPendingOverlay />;
  if (!error) return null;
  return (
    <div
      className="fixed inset-x-4 bottom-24 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-md border border-outline-variant bg-surface p-4 text-sm text-on-surface shadow-lg"
      role="alert"
    >
      <span>{error}</span>
      <button
        type="button"
        className="shrink-0 cursor-pointer rounded-md p-2 hover:bg-surface-container"
        aria-label="Dismiss print error"
        onClick={clearError}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function PrintPendingOverlay() {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = panel.current;
    element?.focus({ preventScroll: true });
    return () => {
      if (
        (document.activeElement === element ||
          document.activeElement === document.body) &&
        previous instanceof HTMLElement &&
        previous.isConnected
      )
        previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface/70 px-6 text-center text-on-surface outline-none"
      onKeyDown={(event) => {
        if (event.key === "Tab" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div role="status" className="flex max-w-md flex-col items-center">
        <Loader2
          className="mb-6 size-12 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
        <h2 id={titleId} className="text-xl font-semibold">
          Opening print dialog…
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-on-surface-variant">
          Please wait while your receipt is prepared.
        </p>
      </div>
    </div>
  );
}
