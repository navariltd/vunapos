import { create } from "zustand";

export type POSPage = "Home" | "Invoices" | "Payments" | "Customers" | "Close Shift";

const PAGE_PATHS: Record<POSPage, string> = {
	Home: "/vunapos",
	Invoices: "/vunapos/invoices",
	Payments: "/vunapos/payments",
	Customers: "/vunapos/customers",
	"Close Shift": "/vunapos/close-shift",
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

export function navigateToPosPage(page: POSPage) {
	const path = getPosPagePath(page);
	if (window.location.pathname !== path || window.location.hash) {
		window.history.pushState({ vunaposPage: page }, "", path);
	}
	useNavigationStore.getState().setActivePage(page);
}

export function navigateToCustomer(customer: string) {
	const path = `/vunapos/customers/${encodeURIComponent(customer)}`;
	window.history.pushState({ vunaposPage: "Customers", customer }, "", path);
	useNavigationStore.getState().setActivePage("Customers");
}

export function getCustomerFromPath(pathname = window.location.pathname): string | null {
	const match = pathname.match(/^\/vunapos\/customers\/([^/]+)\/?$/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function initPosNavigation() {
	const syncFromLocation = () => {
		useNavigationStore.getState().setActivePage(getPosPageFromPath(window.location.pathname));
	};
	window.addEventListener("popstate", syncFromLocation);
	return () => window.removeEventListener("popstate", syncFromLocation);
}
