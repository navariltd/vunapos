import { ChevronDown, CircleUserRound, Lock, Unlock } from "lucide-react";

import { useThemeSync } from "../../features/pos/hooks/useThemeSync";
import { navigateToPosPage } from "../../lib/stores/navigationStore";

export type OrderType = "Sales Invoice" | "Sales Order";

type HeaderProps = {
  allowOrderTypeChange?: boolean;
  orderType?: OrderType;
  onOrderTypeChange?: (orderType: OrderType) => void;
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
    : orderType
      ? [orderType]
      : [];

  return (
    <header className="sticky top-0 z-40 h-12 shrink-0 border-b border-outline-variant bg-surface px-2 sm:px-3">
      <div className="flex h-full items-center justify-between gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="flex cursor-pointer items-center rounded-md p-1 hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => navigateToPosPage("Home")}
            aria-label="Go to VunaPOS home"
            title="Go to home"
          >
            <img
              src="/assets/vunapos/vunapos/vuna-192x192.png"
              alt="VunaPOS"
              className="size-8 rounded-md object-contain sm:size-9"
            />
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => navigateToPosPage("Profile")}
            aria-label="Open user profile"
            title="User profile"
          >
            <CircleUserRound className="size-5" />
          </button>
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
          {orderType && onOrderTypeChange ? (
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
                  <option key={type} value={type}>
                    {type === "Sales Invoice" ? "Invoice" : "Order"}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
            </span>
          </label>
          ) : null}
        </div>
      </div>
    </header>
  );
}
