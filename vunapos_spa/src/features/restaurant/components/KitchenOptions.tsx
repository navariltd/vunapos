import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { KitchenSoundControl } from "../hooks/useKitchenSound";

export function KitchenOptions({
  sound,
  history,
  onHistoryChange,
  canManageAvailability,
}: {
  sound: KitchenSoundControl;
  history: boolean;
  onHistoryChange: (value: boolean) => void;
  canManageAvailability: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="relative" ref={root}>
      <div ref={trigger}>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-label="More kitchen options"
          onClick={() => setOpen(!open)}
        >
          <MoreHorizontal className="mr-1.5 size-4" aria-hidden="true" /> More
        </Button>
      </div>
      {open && (
        <div
          role="group"
          aria-label="Kitchen options"
          className="absolute right-0 z-30 mt-2 w-64 space-y-1 rounded-lg border border-outline-variant bg-surface p-2 text-sm shadow-lg"
        >
          <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 hover:bg-surface-container">
            <input
              type="checkbox"
              checked={history}
              onChange={(event) => onHistoryChange(event.target.checked)}
            />
            Include completed
          </label>
          {canManageAvailability && sound.configured && (
            <button
              type="button"
              className="min-h-10 w-full cursor-pointer rounded-md px-3 text-left hover:bg-surface-container disabled:opacity-50"
              disabled={sound.busy}
              onClick={() => void sound.preview()}
            >
              Test sound
            </button>
          )}
          {canManageAvailability && (
            <a
              className="flex min-h-10 items-center rounded-md px-3 hover:bg-surface-container"
              href="/desk/restaurant-availability"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              Ordering availability
            </a>
          )}
        </div>
      )}
    </div>
  );
}
