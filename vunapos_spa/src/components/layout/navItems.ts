import {
  ClipboardList,
  CreditCard,
  Home,
  LogOut,
  ReceiptText,
  UserRound,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import type { POSPage } from "../../lib/stores/navigationStore";

export type PosMode = "Retail" | "Restaurant";

export type NavItem = {
  label: POSPage;
  title: string;
  icon: typeof Home;
  modes: PosMode[];
  // Pages that keep this item highlighted, e.g. the floor editor under Floor.
  activeFor?: POSPage[];
};

export type NavFeatureFlags = {
  allowCustomerManagement?: boolean;
  allowCustomerPayments?: boolean;
  // Restaurant mode: only users with the VunaPOS Cashier role close shifts.
  canTakePayment?: boolean;
};

const items: NavItem[] = [
  { label: "Home", title: "Home", icon: Home, modes: ["Retail"] },
  { label: "Floor", title: "Floor", icon: UtensilsCrossed, modes: ["Restaurant"], activeFor: ["Floor Editor"] },
  // The order screen is not a nav item; Orders stays highlighted while it is open.
  { label: "Orders", title: "Orders", icon: ClipboardList, modes: ["Restaurant"], activeFor: ["Order"] },
  { label: "Invoices", title: "Sales History", icon: ReceiptText, modes: ["Retail"] },
  { label: "Payments", title: "Payments", icon: CreditCard, modes: ["Retail"] },
  { label: "Customers", title: "Customers", icon: Users, modes: ["Retail"] },
  { label: "Close Shift", title: "Close Shift", icon: LogOut, modes: ["Retail", "Restaurant"] },
];

// The retail bottom nav has no Profile entry. Restaurant mode adds one to keep
// Profile reachable on small screens.
const restaurantProfileItem: NavItem = {
  label: "Profile",
  title: "Profile",
  icon: UserRound,
  modes: ["Restaurant"],
};

export function isItemActive(item: NavItem, activePage: POSPage) {
  return item.label === activePage || Boolean(item.activeFor?.includes(activePage));
}

export function sidebarItems(features?: NavFeatureFlags, mode: PosMode = "Retail") {
  return items.filter((item) => {
    if (!item.modes.includes(mode)) return false;
    if (item.label === "Payments")
      return features?.allowCustomerPayments !== false;
    if (item.label === "Customers")
      return features?.allowCustomerManagement !== false;
    // Restaurant mode shows Close Shift apart from the main navigation (sidebarFooterItems).
    if (item.label === "Close Shift" && mode === "Restaurant") return false;
    return true;
  });
}

// Items at the bottom of the sidebar, just above the user card. Restaurant mode
// puts Close Shift there, for users with the VunaPOS Cashier role only.
export function sidebarFooterItems(features?: NavFeatureFlags, mode: PosMode = "Retail") {
  if (mode !== "Restaurant" || !features?.canTakePayment) return [];
  return items.filter((item) => item.label === "Close Shift");
}

export function bottomNavItems(features?: NavFeatureFlags, mode: PosMode = "Retail") {
  if (mode !== "Restaurant") return sidebarItems(features, mode);
  // Phones: Floor, Orders, Close Shift (cashiers only), Profile.
  return [...sidebarItems(features, mode), ...sidebarFooterItems(features, mode), restaurantProfileItem];
}
