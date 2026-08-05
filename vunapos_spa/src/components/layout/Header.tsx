import { ChevronDown, Lock, Unlock } from "lucide-react";

import { useThemeSync } from "../../features/pos/hooks/useThemeSync";

export type OrderType = "Sales Invoice" | "Sales Order";

type HeaderProps = {
  allowOrderTypeChange?: boolean;
  orderType: OrderType;
  onOrderTypeChange: (orderType: OrderType) => void;
  salesperson?: { name: string; displayName: string; token: string } | null;
  salespersonPinEnabled?: boolean;
  salespersonLocked?: boolean;
  onLockSalesperson?: () => void;
};

export function Header({
  allowOrderTypeChange = true,
  orderType,
  onOrderTypeChange,
  salesperson,
  salespersonPinEnabled,
  salespersonLocked,
  onLockSalesperson,
}: HeaderProps) {
  useThemeSync();
  const orderTypes: OrderType[] = allowOrderTypeChange
    ? ["Sales Invoice", "Sales Order"]
    : [orderType];

  return (
    <header className="sticky top-0 z-40 h-12 shrink-0 border-b border-outline-variant bg-surface px-3 sm:px-5">
      <div className="flex h-full items-center justify-between gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight text-on-surface">
            VunaPOS
          </h1>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {salespersonPinEnabled ? (
            <div className="hidden items-center gap-2 rounded-md bg-surface-container-low px-2 py-1 text-xs sm:flex">
              <span className="text-on-surface-variant">Sales Person</span>
              <span className="max-w-32 truncate font-medium text-on-surface">{salesperson?.displayName || "Locked"}</span>
              {salesperson && onLockSalesperson ? (
                <button type="button" className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface" onClick={onLockSalesperson} aria-label="Lock salesperson session" title="Lock salesperson session">
                  {salespersonLocked ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                </button>
              ) : null}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="hidden sm:inline">Order Type</span>
            <span className="relative">
              <select
                className="h-8 max-w-36 appearance-none rounded-md border border-outline-variant bg-surface-container-low py-0 pl-2 pr-7 text-xs font-medium text-on-surface outline-none hover:border-outline focus:border-primary sm:max-w-none sm:pl-3 sm:pr-8 sm:text-sm"
                disabled={!allowOrderTypeChange}
                value={orderType}
                onChange={(event) =>
                  onOrderTypeChange(event.target.value as OrderType)
                }
              >
                {orderTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
            </span>
          </label>
        </div>
      </div>
    </header>
  );
}
