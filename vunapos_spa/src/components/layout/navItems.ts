import {
  ClipboardList,
  CreditCard,
  Home,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  SquarePen,
  UserRound,
  Users,
} from "lucide-react";

import type { POSPage } from "../../lib/stores/navigationStore";

export type PosMode = "Retail" | "Restaurant";

export type NavItem = {
  label: POSPage;
  title: string;
  icon: typeof Home;
  modes: PosMode[];
  // The bottom nav's text when it differs from the page name.
  shortTitle?: string;
  // Pages that keep this item highlighted, e.g. the order screen under Orders.
  activeFor?: POSPage[];
  // Overrides the page match, for items that share a page with another item.
  isActive?: (page: POSPage, path: string) => boolean;
};

export type NavFeatureFlags = {
  allowCustomerManagement?: boolean;
  allowCustomerPayments?: boolean;
  // Restaurant mode: only users with the VunaPOS Cashier role close shifts.
  canTakePayment?: boolean;
  // Restaurant mode: managers get an "Edit floor plan" link.
  canEditFloorPlan?: boolean;
};

// The order screen holds a new order at /vunapos/order and a saved one at
// /vunapos/order/<name>: "New order" is the first, Orders covers the second.
const isSavedOrderPath = (path: string) => /^\/vunapos\/order\/[^/]+/.test(path);

const items: NavItem[] = [
  { label: "Home", title: "Home", icon: Home, modes: ["Retail"] },
  // Restaurant mode opens on a new order (the menu). The floor is not a nav item:
  // it's only shown to pick a table.
  {
    label: "Order",
    title: "New order",
    shortTitle: "New order",
    icon: SquarePen,
    modes: ["Restaurant"],
    isActive: (page, path) => (page === "Order" && !isSavedOrderPath(path)) || page === "Floor",
  },
  {
    label: "Orders",
    title: "Orders",
    icon: ClipboardList,
    modes: ["Restaurant"],
    isActive: (page, path) => page === "Orders" || (page === "Order" && isSavedOrderPath(path)),
  },
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

const restaurantFloorEditorItem: NavItem = {
  label: "Floor Editor",
  title: "Edit floor plan",
  icon: LayoutDashboard,
  modes: ["Restaurant"],
};

export function isItemActive(item: NavItem, activePage: POSPage, path = "") {
  if (item.isActive) return item.isActive(activePage, path);
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
// puts "Edit floor plan" there for managers and Close Shift for cashiers.
export function sidebarFooterItems(features?: NavFeatureFlags, mode: PosMode = "Retail"): NavItem[] {
  if (mode !== "Restaurant") return [];
  return [
    ...(features?.canEditFloorPlan ? [restaurantFloorEditorItem] : []),
    ...(features?.canTakePayment ? items.filter((item) => item.label === "Close Shift") : []),
  ];
}

export function bottomNavItems(features?: NavFeatureFlags, mode: PosMode = "Retail") {
  if (mode !== "Restaurant") return sidebarItems(features, mode);
  // Phones: New order, Orders, Close Shift (cashiers only), Profile. Managers find
  // "Edit floor plan" on the Profile page.
  return [
    ...sidebarItems(features, mode),
    ...sidebarFooterItems(features, mode).filter((item) => item.label === "Close Shift"),
    restaurantProfileItem,
  ];
}
