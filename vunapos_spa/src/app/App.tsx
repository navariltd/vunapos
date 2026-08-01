import { useState } from "react";

import { AppShell } from "../components/layout/AppShell";
import type { OrderType } from "../components/layout/Header";
import { InstallPrompt } from "../components/InstallPrompt";
import { POSHomePage } from "../features/pos/POSHomePage";
import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { AppProviders } from "./AppProviders";
import { AuthGate } from "./AuthGate";
import { BootstrapGate } from "./BootstrapGate";
import { ConnectivityMonitor } from "./ConnectivityMonitor";
import { PosOpeningGate } from "./PosOpeningGate";

export function App() {
  return (
    <AppProviders>
      <AuthGate>
        <BootstrapGate>
          <PosOpeningGate>
            <AuthenticatedApp />
          </PosOpeningGate>
        </BootstrapGate>
      </AuthGate>
    </AppProviders>
  );
}

function AuthenticatedApp() {
  const bootstrap = useBootstrapData();
  const defaultOrderType =
    bootstrap.data?.default_order_type || "Sales Invoice";
  const [selectedOrderType, setSelectedOrderType] = useState<{
    defaultOrderType: OrderType;
    value: OrderType;
  } | null>(null);
  const orderType =
    selectedOrderType?.defaultOrderType === defaultOrderType
      ? selectedOrderType.value
      : defaultOrderType;

  return (
    <>
      <ConnectivityMonitor />
      <AppShell
        allowOrderTypeChange={bootstrap.data?.allow_order_type_change}
        cashier={bootstrap.data?.current_user}
        features={{
          allowCustomerManagement: bootstrap.data?.allow_customer_management,
          allowCustomerPayments: bootstrap.data?.allow_customer_payments,
        }}
        orderType={orderType}
        onOrderTypeChange={(value) =>
          setSelectedOrderType({ defaultOrderType, value })
        }
        posProfile={bootstrap.data?.pos_profile}
        warehouse={bootstrap.data?.warehouse}
      >
        <POSHomePage bootstrap={bootstrap} orderType={orderType} />
      </AppShell>
      <InstallPrompt />
    </>
  );
}
