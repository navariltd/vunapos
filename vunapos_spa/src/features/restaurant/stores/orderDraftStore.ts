import { create } from "zustand";

import type { CachedServiceType } from "../../../lib/types";
import type { OrderDraft } from "../orderDraft";

// The one order being taken on this device, plus small cross-screen signals.
// Kept in memory only: unsent lines are lost on reload, and the order screen's
// unsaved-changes guard warns before that happens.
type OrderDraftStore = {
	draft: OrderDraft | null;
	// Bumped after every successful order action, so the floor status and the
	// orders list refresh at once instead of waiting for the next poll.
	ordersRevision: number;
	// Set while the floor is used to choose a table for a new order.
	pickingTableFor: CachedServiceType | null;
	setDraft: (draft: OrderDraft | null) => void;
	updateDraft: (update: (draft: OrderDraft) => OrderDraft) => void;
	markOrdersChanged: () => void;
	setPickingTableFor: (serviceType: CachedServiceType | null) => void;
};

export const useOrderDraftStore = create<OrderDraftStore>((set) => ({
	draft: null,
	ordersRevision: 0,
	pickingTableFor: null,
	setDraft: (draft) => set({ draft }),
	updateDraft: (update) => set((state) => (state.draft ? { draft: update(state.draft) } : state)),
	markOrdersChanged: () => set((state) => ({ ordersRevision: state.ordersRevision + 1 })),
	setPickingTableFor: (pickingTableFor) => set({ pickingTableFor }),
}));
