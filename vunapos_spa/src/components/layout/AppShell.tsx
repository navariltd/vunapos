import type { ReactNode } from "react";

import { Header, type OrderType } from "./Header";
import { BottomNav, Sidebar } from "./Sidebar";
import type { NavFeatureFlags } from "./Sidebar";

type AppShellProps = {
  allowOrderTypeChange?: boolean;
  children: ReactNode;
  cashier?: string;
  features?: NavFeatureFlags;
  onOrderTypeChange: (orderType: OrderType) => void;
  orderType: OrderType;
  posProfile?: string;
  warehouse?: string;
  salesperson?: { name: string; displayName: string; token: string } | null;
  salespersonPinEnabled?: boolean;
  salespersonLocked?: boolean;
  onLockSalesperson?: () => void;
};

export function AppShell({
  allowOrderTypeChange,
  cashier,
  children,
  features,
  onOrderTypeChange,
  orderType,
  posProfile,
  warehouse,
  salesperson,
  salespersonPinEnabled,
  salespersonLocked,
  onLockSalesperson,
}: AppShellProps) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-surface text-on-background">
      <Header
        allowOrderTypeChange={allowOrderTypeChange}
        orderType={orderType}
        onOrderTypeChange={onOrderTypeChange}
        salesperson={salesperson}
        salespersonPinEnabled={salespersonPinEnabled}
        salespersonLocked={salespersonLocked}
        onLockSalesperson={onLockSalesperson}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          cashier={cashier}
          features={features}
          posProfile={posProfile}
          warehouse={warehouse}
        />
        <main className="min-h-0 min-w-0 flex-1 bg-surface p-0">
          {children}
        </main>
      </div>
      <BottomNav features={features} />
    </div>
  );
}
