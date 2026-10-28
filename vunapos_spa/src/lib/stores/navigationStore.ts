import { create } from "zustand";

export type POSPage =
	| "Home"
	| "Invoices"
	| "Payments"
	| "Customers"
	| "Close Shift"
	| "Profile"
	| "Floor"
	| "Floor Editor"
	| "Orders"
	| "Order";

export const RESTAURANT_PAGES: readonly POSPage[] = ["Floor", "Floor Editor", "Orders", "Order"];

const PAGE_PATHS: Record<POSPage, string> = {
	Home: "/vunapos",
	Invoices: "/vunapos/invoices",
	Payments: "/vunapos/payments",
	Customers: "/vunapos/customers",
	"Close Shift": "/vunapos/close-shift",
	Profile: "/vunapos/profile",
	Floor: "/vunapos/floor",
	"Floor Editor": "/vunapos/floor/edit",
	Orders: "/vunapos/orders",
	// A new, unsaved order. A saved one is /vunapos/order/<name> (navigateToOrder).
	Order: "/vunapos/order",
};

const PATH_PAGES = new Map(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as POSPage]));

type NavigationStore = {
	activePage: POSPage;
	currentPath: string;
	setActivePage: (page: POSPage) => void;
};

export function getPosPagePath(page: POSPage): string {
	return PAGE_PATHS[page];
}

export function getPosPageFromPath(pathname: string): POSPage {
	const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
	if (normalized.startsWith("/vunapos/customers/")) return "Customers";
	if (normalized.startsWith("/vunapos/invoices/")) return "Invoices";
	if (normalized.startsWith("/vunapos/order/")) return "Order";
	return PATH_PAGES.get(normalized) || "Home";
}

function initialPage(): POSPage {
	return typeof window === "undefined" ? "Home" : getPosPageFromPath(window.location.pathname);
}

// Replaces the old `vunapos_nav` window CustomEvent, which kept two disconnected
// copies of "current page" in sync (Sidebar/BottomNav's own state, POSHomePage's own
// state) purely through an untyped global event - one shared store instead.
export const useNavigationStore = create<NavigationStore>((set) => ({
	activePage: initialPage(),
	currentPath: typeof window === "undefined" ? "/vunapos" : window.location.pathname,
	setActivePage: (page) => set({
		activePage: page,
		currentPath: typeof window === "undefined" ? getPosPagePath(page) : window.location.pathname,
	}),
}));

// Returns false to stop a navigation, e.g. while the floor editor has unsaved
// changes. The guard is expected to ask the user and navigate again itself.
// `path` is where the navigation goes (pages like Order have several paths).
export type NavigationGuard = (page: POSPage, path: string) => boolean;

let navigationGuard: NavigationGuard | null = null;

export function setNavigationGuard(guard: NavigationGuard | null) {
	navigationGuard = guard;
}

export function navigateToPosPage(page: POSPage) {
	const path = getPosPagePath(page);
	if (navigationGuard && !navigationGuard(page, path)) return;
	if (window.location.pathname !== path || window.location.hash) {
		window.history.pushState({ vunaposPage: page }, "", path);
	}
	useNavigationStore.getState().setActivePage(page);
}

export function replacePosPage(page: POSPage) {
	const path = getPosPagePath(page);
	window.history.replaceState({ vunaposPage: page }, "", path);
	useNavigationStore.getState().setActivePage(page);
}

export function navigateToCustomer(customer: string) {
	const path = `/vunapos/customers/${encodeURIComponent(customer)}`;
	window.history.pushState({ vunaposPage: "Customers", customer }, "", path);
	useNavigationStore.getState().setActivePage("Customers");
}

export function navigateToInvoice(invoice: string, invoiceDoctype?: string) {
	const prefix = invoiceDoctype === "Sales Order" ? "/order" : "";
	const path = `/vunapos/invoices${prefix}/${encodeURIComponent(invoice)}`;
	window.history.pushState({ vunaposPage: "Invoices", invoice, invoiceDoctype }, "", path);
	useNavigationStore.getState().setActivePage("Invoices");
}

export function getInvoiceFromPath(pathname = window.location.pathname): string | null {
	const match = pathname.match(/^\/vunapos\/invoices\/(?:order\/)?([^/]+)\/?$/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function getInvoiceDoctypeFromPath(pathname = window.location.pathname): string {
	return /^\/vunapos\/invoices\/order\//.test(pathname) ? "Sales Order" : "";
}

// Restaurant order screen: a saved order by name, or a new order (no name).
// Goes through the navigation guard like any page change; `replace` only renames
// the current screen's URL (a new order that was just saved), so it skips it.
export function navigateToOrder(order?: string | null, { replace = false } = {}) {
	const path = order ? `/vunapos/order/${encodeURIComponent(order)}` : getPosPagePath("Order");
	if (!replace && navigationGuard && !navigationGuard("Order", path)) return;
	if (replace) window.history.replaceState({ vunaposPage: "Order", order }, "", path);
	else if (window.location.pathname !== path) window.history.pushState({ vunaposPage: "Order", order }, "", path);
	useNavigationStore.getState().setActivePage("Order");
}

export function getOrderFromPath(pathname = window.location.pathname): string | null {
	const match = pathname.match(/^\/vunapos\/order\/([^/]+)\/?$/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function getCustomerFromPath(pathname = window.location.pathname): string | null {
	const match = pathname.match(/^\/vunapos\/customers\/([^/]+)\/?$/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function navigateToCustomerPayment(customer: string, invoice?: string) {
	const params = new URLSearchParams({ customer });
	if (invoice) params.set("invoice", invoice);
	window.history.pushState({ vunaposPage: "Payments", customer, invoice }, "", `/vunapos/payments?${params}`);
	useNavigationStore.getState().setActivePage("Payments");
}

export function initPosNavigation() {
	const syncFromLocation = () => {
		const page = getPosPageFromPath(window.location.pathname);
		if (navigationGuard && !navigationGuard(page, window.location.pathname)) {
			// The browser has already moved; put the guarded page back in the address bar.
			window.history.pushState({ vunaposPage: useNavigationStore.getState().activePage }, "", useNavigationStore.getState().currentPath);
			return;
		}
		useNavigationStore.getState().setActivePage(page);
	};
	window.addEventListener("popstate", syncFromLocation);
	return () => window.removeEventListener("popstate", syncFromLocation);
}
