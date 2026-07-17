import { create } from "zustand";

export type POSPage = "Home" | "Invoices" | "Payments" | "Customers" | "Close Shift";

type NavigationStore = {
	activePage: POSPage;
	setActivePage: (page: POSPage) => void;
};

// Replaces the old `vunapos_nav` window CustomEvent, which kept two disconnected
// copies of "current page" in sync (Sidebar/BottomNav's own state, POSHomePage's own
// state) purely through an untyped global event - one shared store instead.
export const useNavigationStore = create<NavigationStore>((set) => ({
	activePage: "Home",
	setActivePage: (page) => set({ activePage: page }),
}));
