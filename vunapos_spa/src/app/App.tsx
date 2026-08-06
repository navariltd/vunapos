import { useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

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
import { VunaApiError, refreshSalespersonPin, vunaMethods } from "../services/vunaApi";
import { useUiFeedbackStore } from "../features/pos/stores/uiFeedbackStore";

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
	const [salesperson, setSalesperson] = useState<{
		name: string;
		displayName: string;
		token: string;
		expiresAt: number;
	} | null>(null);
	const [salespersonUnlocked, setSalespersonUnlocked] = useState(false);
	const refreshSalespersonCall = useFrappePostCall(vunaMethods.refreshSalespersonPin);
	const lastActivityAt = useRef(0);
	const refreshInFlight = useRef(false);
	const showToast = useUiFeedbackStore((state) => state.showToast);
  const orderType =
    selectedOrderType?.defaultOrderType === defaultOrderType
      ? selectedOrderType.value
      : defaultOrderType;
  const salespersonPinEnabled = Boolean(bootstrap.data?.enable_salesperson_pin);
	const salespersonLocked = salespersonPinEnabled && !salespersonUnlocked;

	useEffect(() => {
		if (!salespersonPinEnabled || !salespersonUnlocked || !salesperson) return;
		const markActive = () => {
			lastActivityAt.current = Date.now();
		};
		const events = ["pointerdown", "keydown", "touchstart"] as const;
		events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
		const timer = window.setInterval(() => {
			const now = Date.now();
			if (now >= salesperson.expiresAt) {
				setSalespersonUnlocked(false);
				showToast({ type: "info", message: "Your salesperson PIN session expired. Verify your PIN to continue." });
				return;
			}
			const activeRecently = now - lastActivityAt.current < 5 * 60 * 1000;
			const refreshDue = salesperson.expiresAt - now <= 2 * 60 * 1000;
			if (!activeRecently || !refreshDue || refreshInFlight.current || !bootstrap.data?.pos_profile) return;
			refreshInFlight.current = true;
			void refreshSalespersonPin(refreshSalespersonCall.call, {
				pos_profile: bootstrap.data.pos_profile,
				token: salesperson.token,
			})
				.then((result) => {
					setSalesperson((current) =>
						current
							? { ...current, token: result.token, expiresAt: Date.now() + result.expires_in * 1000 }
							: current,
					);
					lastActivityAt.current = 0;
				})
				.catch((reason) => {
					if (reason instanceof VunaApiError && ["PIN_TOKEN_INVALID", "PIN_TOKEN_REQUIRED"].includes(reason.code || "")) {
						setSalespersonUnlocked(false);
						showToast({ type: "info", message: "Your salesperson PIN session expired. Verify your PIN to continue." });
					}
				})
				.finally(() => {
					refreshInFlight.current = false;
				});
		}, 10_000);
		return () => {
			events.forEach((event) => window.removeEventListener(event, markActive));
			window.clearInterval(timer);
		};
	}, [bootstrap.data?.pos_profile, refreshSalespersonCall.call, salesperson, salespersonPinEnabled, salespersonUnlocked, showToast]);

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
			 salesperson={salesperson}
        salespersonPinEnabled={salespersonPinEnabled}
        salespersonLocked={salespersonLocked}
        onLockSalesperson={() => setSalespersonUnlocked(false)}
      >
        <POSHomePage
          bootstrap={bootstrap}
          orderType={orderType}
          salesperson={salesperson}
          salespersonLocked={salespersonLocked}
			onSalespersonVerified={(verified) => {
				setSalesperson({
					name: verified.name,
					displayName: verified.displayName,
					token: verified.token,
					expiresAt: Date.now() + verified.expiresIn * 1000,
				});
				lastActivityAt.current = 0;
            setSalespersonUnlocked(true);
          }}
          onLockSalesperson={() => setSalespersonUnlocked(false)}
        />
      </AppShell>
      <InstallPrompt />
    </>
  );
}
