import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import {
  RESTAURANT_PAGES,
  navigateToPosPage,
  replacePosPage,
  useNavigationStore,
} from "../../lib/stores/navigationStore";
import { InstallPrompt } from "../../components/InstallPrompt";
import { ConnectivityMonitor } from "../../app/ConnectivityMonitor";
import { useBootstrapData } from "../pos/hooks/useBootstrapData";
import { UserProfilePage } from "../pos/components/UserProfilePage";
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
          <EmptyState
            title="Floor editor"
            description="The floor editor is being built."
            action={
              <Button variant="ghost" className="gap-2" onClick={() => navigateToPosPage("Floor")}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span>Back to floor</span>
              </Button>
            }
          />
        ) : (
          <FloorView posProfile={bootstrap.data?.pos_profile} />
        )}
      </AppShell>
      <RestaurantToast />
      <InstallPrompt />
    </>
  );
}
