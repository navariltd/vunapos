import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { RequestDraft } from "./requestDraft";

export function RequestCheckout({
  draft,
  warehouse,
  workflow,
  busy,
  disabled,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: RequestDraft;
  warehouse: string;
  workflow?: string | null;
  busy: boolean;
  disabled: boolean;
  error: string;
  onChange: (draft: RequestDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-2 sm:p-4">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-checkout-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
            );
            if (!controls?.length) {
              event.preventDefault();
              return;
            }
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
        className="flex h-[calc(100dvh-1rem)] max-h-[52rem] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-lg sm:h-[calc(100dvh-2rem)]"
      >
        <header className="flex items-center justify-between border-b border-outline-variant p-4">
          <div>
            <h2 id="request-checkout-title" className="text-lg font-semibold">
              Checkout
            </h2>
            <p className="text-sm text-on-surface-variant">
              Stock request{draft.name ? ` · ${draft.name}` : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close checkout"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-2 hover:bg-surface-container"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-2">
          <section
            className="space-y-4 p-4 sm:p-6"
            aria-label="Request details"
          >
            <label className="block text-sm font-medium">
              Required by
              <input
                type="date"
                value={draft.requiredBy}
                disabled={busy}
                onChange={(event) =>
                  onChange({ ...draft, requiredBy: event.target.value })
                }
                className="mt-1 h-touch w-full rounded-md border border-outline-variant bg-surface px-3"
              />
            </label>
            <label className="block text-sm font-medium">
              Notes
              <textarea
                value={draft.notes}
                disabled={busy}
                maxLength={1000}
                rows={4}
                onChange={(event) =>
                  onChange({ ...draft, notes: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-outline-variant bg-surface p-3"
              />
            </label>
            {workflow ? (
              <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-on-surface">
                Workflow: <strong>{workflow}</strong> · Actions available after
                checkout
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="rounded-md bg-error-container p-3 text-sm text-on-error-container"
              >
                {error}
              </p>
            ) : null}
          </section>
          <section
            className="bg-surface-container-low p-4 sm:p-6"
            aria-label="Request summary"
          >
            <h3 className="font-semibold">Request summary</h3>
            <p className="mt-3 text-xs text-on-surface-variant">
              Destination warehouse
            </p>
            <p className="text-sm">{warehouse}</p>
            <ul className="mt-4 divide-y divide-outline-variant">
              {draft.lines.map((row, index) => (
                <li
                  key={index}
                  className="flex justify-between gap-3 py-3 text-sm"
                >
                  <span>
                    {row.item.item_name}
                    <span className="block text-xs text-on-surface-variant">
                      {row.item.item_code}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">
                    {row.qty.toLocaleString()} {row.uom}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-outline-variant p-3 sm:p-4">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Back
          </Button>
          <Button disabled={disabled || busy} onClick={onSubmit}>
            {busy
              ? "Please wait…"
              : workflow
              ? "Save request"
              : "Submit request"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
