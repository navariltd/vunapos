import { useEffect } from "react";

import { AppShell } from "../../components/layout/AppShell";
import {
  navigateToPosPage,
  replacePosPage,
  useNavigationStore,
  getRestaurantSessionFromPath,
  getOrderFromPath,
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
import { SessionScreen } from "./components/SessionScreen";
import { OrdersPage } from "./components/OrdersPage";
import { RestaurantToast } from "./components/RestaurantToast";
import { SharedRestaurantPages } from "./components/SharedRestaurantPages";
import {
  isRestaurantPageAllowed,
  restaurantRoleLabel,
} from "./restaurantRoles";

// Restaurant mode shell. Per design decision 6, users who can take payment
// (VunaPOS Cashier) must have an open shift before they get in; everyone else,
// managers included, goes straight to the floor with no shift.
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
  const currentPath = useNavigationStore((s) => s.currentPath);
  const sessionName = getRestaurantSessionFromPath(currentPath);
  const features = {
    canTakePayment,
    allowCustomerManagement:
      bootstrap.data?.allow_customer_management !== false,
    allowCustomerPayments: bootstrap.data?.allow_customer_payments !== false,
  };
  const isAllowedPage = isRestaurantPageAllowed(
    activePage,
    canTakePayment,
    features
  );

  useEffect(() => {
    // Disabled profile features and pages the user can't use return to selling.
    if (!isAllowedPage) replacePosPage("Home");
  }, [isAllowedPage]);

  const posProfile = bootstrap.data?.pos_profile;

  return (
    <>
      <ConnectivityMonitor />
      <AppShell
        mode="Restaurant"
        cashier={bootstrap.data?.current_user}
        features={features}
        posProfile={posProfile}
        warehouse={bootstrap.data?.warehouse}
      >
        {!isAllowedPage ? null : ["Invoices", "Payments", "Customers"].includes(
            activePage
          ) && bootstrap.data ? (
          <SharedRestaurantPages
            page={activePage}
            path={currentPath}
            bootstrap={bootstrap.data}
          />
        ) : activePage === "Profile" ? (
          <UserProfilePage
            bootstrap={bootstrap.data}
            roleLabel={restaurantRoleLabel(bootstrap.data?.restaurant_roles)}
            onCloseShift={
              canTakePayment
                ? () => navigateToPosPage("Close Shift")
                : undefined
            }
          />
        ) : activePage === "Close Shift" && canTakePayment && posProfile ? (
          <CloseShiftPage
            currency={bootstrap.data?.currency}
            posProfile={posProfile}
            onBack={() => navigateToPosPage("Floor")}
          />
        ) : activePage === "Floor Editor" ? (
          <FloorEditor posProfile={posProfile} />
        ) : activePage === "Orders" ? (
          <OrdersPage posProfile={posProfile} />
        ) : activePage === "Order" && getOrderFromPath(currentPath) ? (
          <OrderScreen posProfile={posProfile} />
        ) : activePage === "Order" || activePage === "Home" ? (
          <SessionScreen
            key={sessionName || "new-sale"}
            sessionName={sessionName}
            posProfile={posProfile}
          />
        ) : (
          <FloorView posProfile={posProfile} />
        )}
      </AppShell>
      <RestaurantToast />
      <InstallPrompt />
    </>
  );
}
