import { create } from "zustand";

import type { OrderDraft } from "../orderDraft";

// Why the floor is open: to choose a table, then come back ("return") or come
// back and send the order straight away ("send", when Send needed a table).
export type TablePicking = { then: "return" | "send" };

// Shown after a new order is sent and the screen has reset to the next one.
export type SentNotice = { order: string; label: string };

// The one order being taken on this device, plus small cross-screen signals.
// Kept in memory only: unsent lines are lost on reload, and the order screen's
// unsaved-changes guard warns before that happens.
type OrderDraftStore = {
	draft: OrderDraft | null;
	// Bumped after every successful order action, so the floor status and the
	// orders list refresh at once instead of waiting for the next poll.
	ordersRevision: number;
	// Set while the floor is used to choose a table for the draft.
	picking: TablePicking | null;
	// Set when the order screen should send the draft as soon as it shows it
	// (after picking a table for Send, or adding the lines to an open order).
	sendOnArrival: boolean;
	sentNotice: SentNotice | null;
	setDraft: (draft: OrderDraft | null) => void;
	updateDraft: (update: (draft: OrderDraft) => OrderDraft) => void;
	markOrdersChanged: () => void;
	setPicking: (picking: TablePicking | null) => void;
	setSendOnArrival: (value: boolean) => void;
	setSentNotice: (notice: SentNotice | null) => void;
};

export const useOrderDraftStore = create<OrderDraftStore>((set) => ({
	draft: null,
	ordersRevision: 0,
	picking: null,
	sendOnArrival: false,
	sentNotice: null,
	setDraft: (draft) => set({ draft }),
	updateDraft: (update) => set((state) => (state.draft ? { draft: update(state.draft) } : state)),
	markOrdersChanged: () => set((state) => ({ ordersRevision: state.ordersRevision + 1 })),
	setPicking: (picking) => set({ picking }),
	setSendOnArrival: (sendOnArrival) => set({ sendOnArrival }),
	setSentNotice: (sentNotice) => set({ sentNotice }),
}));
