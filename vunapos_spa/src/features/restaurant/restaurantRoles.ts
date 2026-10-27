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

// Restaurant pages a user may open. Close Shift is for cashiers only; any
// other page (including retail URLs) falls back to the floor.
export function isRestaurantPageAllowed(page: POSPage, canTakePayment: boolean) {
  if (page === "Close Shift") return canTakePayment;
  return ["Floor", "Floor Editor", "Orders", "Order", "Profile"].includes(page);
}
