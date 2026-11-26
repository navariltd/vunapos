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
import { QrCodesPage } from "./components/QrCodesPage";
import { FloorView } from "./components/FloorView";
import { OrderScreen } from "./components/OrderScreen";
import { SessionScreen } from "./components/SessionScreen";
import { OrdersPage } from "./components/OrdersPage";
import { KitchenPage } from "./components/KitchenPage";
import { RestaurantToast } from "./components/RestaurantToast";
import { WaiterReadyAlerts } from "./components/WaiterReadyAlerts";
import { SharedRestaurantPages } from "./components/SharedRestaurantPages";
import { draftScope, useOrderDraftStore } from "./stores/orderDraftStore";
import {
  isRestaurantPageAllowed,
  restaurantRoleLabel,
  isKitchenOnlyUser,
  needsRestaurantShift,
} from "./restaurantRoles";

// All selling users own shifts; only kitchen-only operators bypass opening.
export function RestaurantApp() {
  const bootstrap = useBootstrapData();
  const canTakePayment = Boolean(bootstrap.data?.can_take_payment);

  if (
    needsRestaurantShift(
      bootstrap.data?.restaurant_roles,
      canTakePayment,
      bootstrap.data?.can_manage_restaurant
    )
  ) {
    return (
      <PosOpeningGate>
        <RestaurantShell canTakePayment={canTakePayment} />
      </PosOpeningGate>
    );
  }
  return <RestaurantShell canTakePayment={false} />;
}

function RestaurantShell({ canTakePayment }: { canTakePayment: boolean }) {
  const bootstrap = useBootstrapData();
  const user = bootstrap.data?.current_user;
  const profile = bootstrap.data?.pos_profile;
  const scope = useOrderDraftStore((state) => state.scope);
  const storageError = useOrderDraftStore((state) => state.storageError);
  const savedDraft = useOrderDraftStore((state) => state.draft);
  useEffect(() => {
    if (user && profile)
      useOrderDraftStore.getState().activateScope(user, profile);
  }, [user, profile]);
  const activePage = useNavigationStore((s) => s.activePage);
  const currentPath = useNavigationStore((s) => s.currentPath);
  const sessionName = getRestaurantSessionFromPath(currentPath);
  const roles = bootstrap.data?.restaurant_roles || [];
  const canManageShift = needsRestaurantShift(
    roles,
    canTakePayment,
    bootstrap.data?.can_manage_restaurant
  );
  const kitchenOnly = isKitchenOnlyUser(
    roles,
    bootstrap.data?.can_manage_restaurant
  );
  const features = {
    canTakePayment,
    canManageShift,
    kitchenOnly,
    allowCustomerManagement:
      bootstrap.data?.allow_customer_management !== false,
    allowCustomerPayments: bootstrap.data?.allow_customer_payments !== false,
    allowCustomerCreation: bootstrap.data?.allow_customer_creation !== false,
  };
  const isAllowedPage = isRestaurantPageAllowed(
    activePage,
    canTakePayment,
    features
  );

  useEffect(() => {
    // Disabled profile features and pages the user can't use return to selling.
    if (!isAllowedPage) replacePosPage(kitchenOnly ? "Kitchen" : "Home");
  }, [isAllowedPage, kitchenOnly]);

  const posProfile = bootstrap.data?.pos_profile;

  if (!user || !profile || scope !== draftScope(user, profile)) return null;

  return (
    <>
      <ConnectivityMonitor />
      <AppShell
        headerActions={
          !kitchenOnly ? (
            <WaiterReadyAlerts key={`${user}:${profile}`} user={user} soundSettings={bootstrap.data?.restaurant?.sound_settings} />
          ) : undefined
        }
        mode="Restaurant"
        cashier={bootstrap.data?.current_user}
        features={features}
        posProfile={posProfile}
        warehouse={bootstrap.data?.warehouse}
      >
        {storageError &&
        !savedDraft &&
        ["Home", "Order"].includes(activePage) ? (
          <p role="alert" className="p-6 text-error">
            {storageError}
          </p>
        ) : !isAllowedPage ? null : [
            "Invoices",
            "Payments",
            "Customers",
          ].includes(activePage) && bootstrap.data ? (
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
              canManageShift
                ? () => navigateToPosPage("Close Shift")
                : undefined
            }
          />
        ) : activePage === "Close Shift" && canManageShift && posProfile ? (
          <CloseShiftPage
            currency={bootstrap.data?.currency}
            posProfile={posProfile}
            onBack={() => navigateToPosPage("Floor")}
          />
        ) : activePage === "Floor Editor" ? (
          <FloorEditor posProfile={posProfile} />
        ) : activePage === "QR Codes" ? (
          <QrCodesPage posProfile={posProfile} />
        ) : activePage === "Orders" ? (
          <OrdersPage posProfile={posProfile} />
        ) : activePage === "Kitchen" ? (
          <KitchenPage posProfile={posProfile} soundSettings={bootstrap.data?.restaurant?.sound_settings} />
        ) : activePage === "Order" && getOrderFromPath(currentPath) ? (
          <OrderScreen posProfile={posProfile} />
        ) : activePage === "Order" || activePage === "Home" ? (
          <SessionScreen
            key={sessionName || "new-sale"}
            sessionName={sessionName}
            posProfile={posProfile}
            allowCustomerCreation={features.allowCustomerCreation}
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
