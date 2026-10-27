import { create } from "zustand";

import { DEFAULT_ORDERS_FILTER, type OrdersFilter } from "../ordersFilter";

// The Orders page filters, kept in memory so they survive opening an order and
// coming back.
type OrdersFilterStore = {
	filter: OrdersFilter;
	setFilter: (patch: Partial<OrdersFilter>) => void;
	clearFilters: () => void;
};

export const useOrdersFilterStore = create<OrdersFilterStore>((set) => ({
	filter: DEFAULT_ORDERS_FILTER,
	setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),
	// Clearing keeps the chosen sort order.
	clearFilters: () => set((state) => ({ filter: { ...DEFAULT_ORDERS_FILTER, sort: state.filter.sort } })),
}));
