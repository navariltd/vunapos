import { create } from "zustand";

import type { InvoiceDTO } from "../types";

export type Toast =
	| { type: "submitted" | "held"; invoice: InvoiceDTO }
	| { type: "error"; message: string };

type UiFeedbackStore = {
	toast: Toast | null;
	toastClosing: boolean;
	pageError: string | null;
	showToast: (toast: Toast) => void;
	clearToast: () => void;
	setPageError: (message: string | null) => void;
};

const TOAST_TTL_MS = 5000;
const TOAST_EXIT_MS = 250;

// Bare setTimeout/clearTimeout (not window.*) - this module also runs under the Node
// vitest environment, where `window` doesn't exist.
let toastExitTimeoutId: ReturnType<typeof setTimeout> | undefined;
let toastRemovalTimeoutId: ReturnType<typeof setTimeout> | undefined;

export const useUiFeedbackStore = create<UiFeedbackStore>((set) => ({
	toast: null,
	toastClosing: false,
	pageError: null,
	showToast: (toast) => {
		clearTimeout(toastExitTimeoutId);
		clearTimeout(toastRemovalTimeoutId);
		set({ toast, toastClosing: false });
		toastExitTimeoutId = setTimeout(() => set({ toastClosing: true }), TOAST_TTL_MS - TOAST_EXIT_MS);
		toastRemovalTimeoutId = setTimeout(() => set({ toast: null, toastClosing: false }), TOAST_TTL_MS);
	},
	clearToast: () => {
		clearTimeout(toastExitTimeoutId);
		clearTimeout(toastRemovalTimeoutId);
		set((state) => state.toast ? { toastClosing: true } : state);
		toastRemovalTimeoutId = setTimeout(() => set({ toast: null, toastClosing: false }), TOAST_EXIT_MS);
	},
	setPageError: (pageError) => set({ pageError }),
}));
