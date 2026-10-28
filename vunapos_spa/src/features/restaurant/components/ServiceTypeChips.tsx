import { Loader2 } from "lucide-react";

import { cn } from "../../../lib/cn";
import type { CachedServiceType } from "../../../lib/types";
import { sortedServiceTypes } from "../tableStatus";

type ServiceTypeChipsProps = {
  serviceTypes: CachedServiceType[];
  value: string | null;
  // A saved order's service type is fixed (switching it is stage 2).
  readOnly?: boolean;
  // The type whose menu is being checked before switching.
  checking?: string | null;
  // Shown under the chips, e.g. when Send needs a service type.
  message?: string | null;
  onSelect: (serviceType: CachedServiceType) => void;
};

// One row of service type chips that scrolls sideways, in display order.
export function ServiceTypeChips({ serviceTypes, value, readOnly, checking, message, onSelect }: ServiceTypeChipsProps) {
  const types = sortedServiceTypes(serviceTypes);
  const visible = readOnly ? types.filter((type) => type.name === value) : types;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-1",
          message && "rounded-md outline-2 outline-offset-2 outline-error",
        )}
        role="radiogroup"
        aria-label="Service type"
      >
        {visible.map((type) => {
          const selected = type.name === value;
          return (
            <button
              key={type.name}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={readOnly || Boolean(checking)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors disabled:cursor-default",
                selected
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant text-on-surface hover:bg-surface-container disabled:opacity-60",
              )}
              onClick={() => onSelect(type)}
            >
              {checking === type.name ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {type.service_type_name}
            </button>
          );
        })}
      </div>
      {message ? (
        <p className="mt-1 text-xs font-medium text-error" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
