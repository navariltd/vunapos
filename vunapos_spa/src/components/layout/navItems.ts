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
  { label: "Home", title: "Home", icon: Home, modes: ["Retail", "Restaurant"] },
  { label: "Floor", title: "Floor", icon: UtensilsCrossed, modes: ["Restaurant"], activeFor: ["Floor Editor"] },
  // The order screen is not a nav item; Orders stays highlighted while it is open.
  { label: "Orders", title: "Open Orders", icon: ClipboardList, modes: ["Restaurant"], activeFor: ["Order"] },
  { label: "Invoices", title: "Sales History", icon: ReceiptText, modes: ["Retail", "Restaurant"] },
  { label: "Payments", title: "Payments", icon: CreditCard, modes: ["Retail", "Restaurant"] },
  { label: "Customers", title: "Customers", icon: Users, modes: ["Retail", "Restaurant"] },
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
    // Keep Close Shift in the same main-navigation position as retail.
    if (mode === "Restaurant" && item.label === "Close Shift") return Boolean(features?.canTakePayment);
    if (mode === "Restaurant" && item.label === "Floor") return false;
    return true;
  });
}

// Items at the bottom of the sidebar, just above the user card. Restaurant mode
// keeps Floor available to everyone below Collapse.
export function sidebarFooterItems(_features?: NavFeatureFlags, mode: PosMode = "Retail") {
  if (mode !== "Restaurant") return [];
  return items.filter((item) => item.label === "Floor");
}

export function bottomNavItems(features?: NavFeatureFlags, mode: PosMode = "Retail") {
  if (mode !== "Restaurant") return sidebarItems(features, mode);
  // The mobile renderer puts secondary entries in More when space is limited.
  return [...sidebarItems(features, mode), ...sidebarFooterItems(features, mode), restaurantProfileItem];
}
