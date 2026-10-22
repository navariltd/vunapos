import { useEffect, type ReactNode } from "react";

import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { RESTAURANT_PAGES, replacePosPage, useNavigationStore } from "../lib/stores/navigationStore";

type PosModeSwitchProps = {
  retail: ReactNode;
  restaurant: ReactNode;
};

// Routes to the interface for the resolved POS Profile's mode. There is no
// mode picker: the profile decides. Anything other than Restaurant is Retail.
export function PosModeSwitch({ retail, restaurant }: PosModeSwitchProps) {
  const bootstrap = useBootstrapData();
  const activePage = useNavigationStore((s) => s.activePage);
  const mode = bootstrap.data ? (bootstrap.data.pos_mode === "Restaurant" ? "Restaurant" : "Retail") : null;
  const isOnRestaurantPage = RESTAURANT_PAGES.includes(activePage);

  useEffect(() => {
    // A restaurant URL opened on a retail profile falls back to the retail home.
    if (mode === "Retail" && isOnRestaurantPage) replacePosPage("Home");
  }, [mode, isOnRestaurantPage]);

  if (!mode) {
    // Wait for the cached profile so a restaurant user never sees the retail
    // opening-entry gate flash up first. Matches BootstrapGate's loading state.
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
        <div className="text-sm font-medium text-on-surface-variant">Loading VunaPOS data...</div>
      </div>
    );
  }

  return <>{mode === "Restaurant" ? restaurant : retail}</>;
}
