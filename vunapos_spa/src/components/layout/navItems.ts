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

// The retail bottom nav has no Profile entry. Restaurant mode has only one page,
// so Profile is added there to keep it reachable on small screens.
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
    if (item.label === "Close Shift" && mode === "Restaurant")
      return Boolean(features?.canTakePayment);
    return true;
  });
}

export function bottomNavItems(features?: NavFeatureFlags, mode: PosMode = "Retail") {
  if (mode !== "Restaurant") return sidebarItems(features, mode);
  // Phones keep Floor and Profile; cashiers reach Close Shift from Profile.
  return [
    ...sidebarItems(features, mode).filter((item) => item.label !== "Close Shift"),
    restaurantProfileItem,
  ];
}
