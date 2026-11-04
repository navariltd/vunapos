import type { POSPage } from "../../lib/stores/navigationStore";

// Short names for the VunaPOS roles, in the order the server sends them.
const ROLE_LABELS: Record<string, string> = {
  "VunaPOS Waiter": "Waiter",
  "VunaPOS Cashier": "Cashier",
  "VunaPOS Restaurant Manager": "Manager",
};

export function restaurantRoleLabel(roles?: string[] | null) {
  const labels = (roles || []).map((role) => ROLE_LABELS[role]).filter(Boolean);
  return labels.length ? labels.join(" · ") : "VunaPOS user";
}

// Shared pages remain available in restaurant mode, subject to profile feature
// switches. Close Shift is cashier-only; backend document permissions still apply.
export function isRestaurantPageAllowed(
  page: POSPage,
  canTakePayment: boolean,
  features?: {
    allowCustomerPayments?: boolean;
    allowCustomerManagement?: boolean;
  }
) {
  if (page === "Close Shift") return canTakePayment;
  if (page === "Payments") return features?.allowCustomerPayments !== false;
  if (page === "Customers") return features?.allowCustomerManagement !== false;
  return [
    "Home",
    "Floor",
    "Floor Editor",
    "Orders",
    "Order",
    "Profile",
    "Invoices",
  ].includes(page);
}
