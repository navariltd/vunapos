import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type SheetProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
};

// A bottom sheet on phones and a centred dialog on larger screens. Escape, the
// backdrop and the close button dismiss it.
export function Sheet({ isOpen, title, description, children, footer, onClose }: SheetProps) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 animate-fade-in sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restaurant-sheet-title"
        className="flex max-h-[85dvh] w-full flex-col rounded-t-xl border border-outline-variant bg-surface shadow-xl sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-start gap-3 border-b border-outline-variant px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="restaurant-sheet-title" className="text-base font-semibold text-on-surface">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-on-surface-variant">{description}</p> : null}
          </div>
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer ? <div className="border-t border-outline-variant p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </div>
  );
}
