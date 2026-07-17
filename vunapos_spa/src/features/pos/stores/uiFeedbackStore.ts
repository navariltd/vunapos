import { create } from "zustand";

import type { InvoiceDTO } from "../types";

export type Toast = { type: "submitted" | "held"; invoice: InvoiceDTO };

type UiFeedbackStore = {
	toast: Toast | null;
	pageError: string | null;
	showToast: (toast: Toast) => void;
	clearToast: () => void;
	setPageError: (message: string | null) => void;
};

const TOAST_TTL_MS = 5000;

// Bare setTimeout/clearTimeout (not window.*) - this module also runs under the Node
// vitest environment, where `window` doesn't exist.
let toastTimeoutId: ReturnType<typeof setTimeout> | undefined;

export const useUiFeedbackStore = create<UiFeedbackStore>((set) => ({
	toast: null,
	pageError: null,
	showToast: (toast) => {
		clearTimeout(toastTimeoutId);
		set({ toast });
		toastTimeoutId = setTimeout(() => set({ toast: null }), TOAST_TTL_MS);
	},
	clearToast: () => {
		clearTimeout(toastTimeoutId);
		set({ toast: null });
	},
	setPageError: (pageError) => set({ pageError }),
}));
