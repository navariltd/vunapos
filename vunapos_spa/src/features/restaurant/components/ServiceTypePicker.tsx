import { Armchair, ShoppingBag } from "lucide-react";

import { cn } from "../../../lib/cn";
import type { CachedServiceType } from "../../../lib/types";
import { sortedServiceTypes } from "../tableStatus";
import { Sheet } from "./Sheet";

type ServiceTypePickerProps = {
  isOpen: boolean;
  serviceTypes: CachedServiceType[];
  onSelect: (serviceType: CachedServiceType) => void;
  onClose: () => void;
};

// "New order": one large button per service type, in display order, with the
// default one marked and focused first.
export function ServiceTypePicker({ isOpen, serviceTypes, onSelect, onClose }: ServiceTypePickerProps) {
  const types = sortedServiceTypes(serviceTypes);
  return (
    <Sheet isOpen={isOpen} title="New order" description="Choose the service type." onClose={onClose}>
      {types.length ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {types.map((type) => {
            const Icon = type.requires_table ? Armchair : ShoppingBag;
            return (
              <button
                key={type.name}
                type="button"
                autoFocus={type.is_default}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-primary",
                  type.is_default ? "border-primary bg-primary/5" : "border-outline-variant",
                )}
                onClick={() => onSelect(type)}
              >
                <Icon className="size-6 shrink-0 text-on-surface-variant" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-on-surface">{type.service_type_name}</span>
                  <span className="block text-xs text-on-surface-variant">
                    {type.requires_table ? "Choose a table next" : "No table needed"}
                    {type.is_default ? " · Default" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-on-surface-variant">
          This POS Profile offers no service types. Ask a manager to check the restaurant setup.
        </p>
      )}
    </Sheet>
  );
}
