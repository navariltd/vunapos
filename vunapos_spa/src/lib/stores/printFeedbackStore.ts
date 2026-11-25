import { create } from "zustand";

type PrintFeedback = {
  pending: number;
  error: string | null;
  begin: () => () => void;
  fail: () => void;
  clearError: () => void;
};

export const usePrintFeedbackStore = create<PrintFeedback>((set) => ({
  pending: 0,
  error: null,
  begin: () => {
    set((state) => ({ pending: state.pending + 1, error: null }));
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      set((state) => ({ pending: Math.max(0, state.pending - 1) }));
    };
  },
  fail: () =>
    set({
      error:
        "The print dialog could not be opened. Retry printing from the document; do not complete the sale again.",
    }),
  clearError: () => set({ error: null }),
}));
