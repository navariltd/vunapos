import { useEffect } from "react";

import { AppShell } from "../../components/layout/AppShell";
import {
  RESTAURANT_PAGES,
  replacePosPage,
  useNavigationStore,
} from "../../lib/stores/navigationStore";
import { InstallPrompt } from "../../components/InstallPrompt";
import { ConnectivityMonitor } from "../../app/ConnectivityMonitor";
import { useBootstrapData } from "../pos/hooks/useBootstrapData";
import { UserProfilePage } from "../pos/components/UserProfilePage";
import { FloorEditor } from "./components/FloorEditor";
import { FloorView } from "./components/FloorView";
import { RestaurantToast } from "./components/RestaurantToast";

// Restaurant mode shell. No POS Opening Entry is required here: per design
// decision 6 the opening gate will guard payment once checkout is built.
export function RestaurantApp() {
  const bootstrap = useBootstrapData();
  const activePage = useNavigationStore((s) => s.activePage);
  const isRestaurantPage = RESTAURANT_PAGES.includes(activePage) || activePage === "Profile";

  useEffect(() => {
    // /vunapos and retail-only pages resolve to the floor view.
    if (!isRestaurantPage) replacePosPage("Floor");
  }, [isRestaurantPage]);

  return (
    <>
      <ConnectivityMonitor />
      <AppShell
        mode="Restaurant"
        cashier={bootstrap.data?.current_user}
        posProfile={bootstrap.data?.pos_profile}
        warehouse={bootstrap.data?.warehouse}
      >
        {activePage === "Profile" ? (
          <UserProfilePage bootstrap={bootstrap.data} />
        ) : activePage === "Floor Editor" ? (
          <FloorEditor posProfile={bootstrap.data?.pos_profile} />
        ) : (
          <FloorView posProfile={bootstrap.data?.pos_profile} />
        )}
      </AppShell>
      <RestaurantToast />
      <InstallPrompt />
    </>
  );
}
