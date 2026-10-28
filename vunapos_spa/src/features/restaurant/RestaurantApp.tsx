import { useEffect } from "react";

import { AppShell } from "../../components/layout/AppShell";
import {
  navigateToPosPage,
  replacePosPage,
  useNavigationStore,
} from "../../lib/stores/navigationStore";
import { InstallPrompt } from "../../components/InstallPrompt";
import { ConnectivityMonitor } from "../../app/ConnectivityMonitor";
import { PosOpeningGate } from "../../app/PosOpeningGate";
import { useBootstrapData } from "../pos/hooks/useBootstrapData";
import { CloseShiftPage } from "../pos/components/CloseShiftPage";
import { UserProfilePage } from "../pos/components/UserProfilePage";
import { FloorEditor } from "./components/FloorEditor";
import { FloorView } from "./components/FloorView";
import { OrderScreen } from "./components/OrderScreen";
import { OrdersPage } from "./components/OrdersPage";
import { RestaurantToast } from "./components/RestaurantToast";
import { isRestaurantPageAllowed, restaurantRoleLabel } from "./restaurantRoles";
import { useOrderDraftStore } from "./stores/orderDraftStore";

// Restaurant mode shell. Per design decision 6, users who can take payment
// (VunaPOS Cashier) must have an open shift before they get in; everyone else,
// managers included, goes straight in with no shift. Everyone lands on a new
// order (the menu); the floor only opens to pick a table (decision 14).
export function RestaurantApp() {
  const bootstrap = useBootstrapData();
  const canTakePayment = Boolean(bootstrap.data?.can_take_payment);

  if (canTakePayment) {
    return (
      <PosOpeningGate>
        <RestaurantShell canTakePayment />
      </PosOpeningGate>
    );
  }
  return <RestaurantShell canTakePayment={false} />;
}

function RestaurantShell({ canTakePayment }: { canTakePayment: boolean }) {
  const bootstrap = useBootstrapData();
  const activePage = useNavigationStore((s) => s.activePage);
  const isAllowedPage = isRestaurantPageAllowed(activePage, canTakePayment);
  const picking = useOrderDraftStore((s) => s.picking);
  const setPicking = useOrderDraftStore((s) => s.setPicking);
  const canEditFloorPlan = Boolean(bootstrap.data?.can_edit_floor_plan);

  useEffect(() => {
    // /vunapos, retail-only pages and pages the user can't use resolve to a new order.
    if (!isAllowedPage) replacePosPage("Order");
  }, [isAllowedPage]);

  useEffect(() => {
    // Picking a table only lasts while the floor is on screen.
    if (picking && activePage !== "Floor") setPicking(null);
  }, [activePage, picking, setPicking]);

  const posProfile = bootstrap.data?.pos_profile;

  return (
    <>
      <ConnectivityMonitor />
      <AppShell
        mode="Restaurant"
        cashier={bootstrap.data?.current_user}
        features={{ canTakePayment, canEditFloorPlan }}
        posProfile={posProfile}
        warehouse={bootstrap.data?.warehouse}
      >
        {activePage === "Profile" ? (
          <UserProfilePage
            bootstrap={bootstrap.data}
            roleLabel={restaurantRoleLabel(bootstrap.data?.restaurant_roles)}
            onCloseShift={canTakePayment ? () => navigateToPosPage("Close Shift") : undefined}
            onEditFloorPlan={canEditFloorPlan ? () => navigateToPosPage("Floor Editor") : undefined}
          />
        ) : activePage === "Close Shift" && canTakePayment && posProfile ? (
          <CloseShiftPage
            currency={bootstrap.data?.currency}
            posProfile={posProfile}
            onBack={() => navigateToPosPage("Order")}
          />
        ) : activePage === "Floor Editor" ? (
          <FloorEditor posProfile={posProfile} />
        ) : activePage === "Orders" ? (
          <OrdersPage posProfile={posProfile} />
        ) : activePage === "Order" ? (
          <OrderScreen posProfile={posProfile} />
        ) : (
          <FloorView posProfile={posProfile} />
        )}
      </AppShell>
      <RestaurantToast />
      <InstallPrompt />
    </>
  );
}
