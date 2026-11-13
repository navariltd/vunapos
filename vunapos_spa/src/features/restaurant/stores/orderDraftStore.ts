import { create } from "zustand";

import type { CachedServiceType } from "../../../lib/types";
import type { OrderDraft } from "../orderDraft";
import type { PendingPlacement } from "../placement";

type SavedDraft = {
  draft: OrderDraft | null;
  pendingPlacement: PendingPlacement | null;
};
type OrderDraftStore = SavedDraft & {
  scope: string | null;
  storageError: string | null;
  storageReadFailed: boolean;
  ordersRevision: number;
  pickingTableFor: CachedServiceType | null;
  activateScope: (user: string, profile: string) => void;
  setDraft: (draft: OrderDraft | null) => void;
  updateDraft: (update: (draft: OrderDraft) => OrderDraft) => void;
  beginPlacement: (intent: PendingPlacement) => PendingPlacement;
  rememberSession: (session: string) => void;
  finishPlacement: (draft: OrderDraft | null) => void;
  rejectPlacement: () => void;
  markOrdersChanged: () => void;
  setPickingTableFor: (serviceType: CachedServiceType | null) => void;
};

export function draftScope(user: string, profile: string) {
  return `vunapos.restaurant-draft.v1:${encodeURIComponent(
    user
  )}:${encodeURIComponent(profile)}`;
}

// sessionStorage survives reloads but isolates terminals/tabs. Never share one
// browser cart between cashiers or profiles, and never persist payment data here.
export const useOrderDraftStore = create<OrderDraftStore>((set, get) => {
  const write = (saved: SavedDraft) => {
    const scope = get().scope;
    if (scope) {
      try {
        sessionStorage.setItem(scope, JSON.stringify(saved));
        set({ storageError: null });
      } catch {
        const message =
          "Your browser could not save this order for recovery. Free browser storage before placing it.";
        set({ storageError: message });
        throw new Error(message);
      }
    }
  };
  const edit = (draft: OrderDraft | null) => {
    if (get().pendingPlacement || get().storageReadFailed) return;
    set({ draft });
    try {
      write({ draft, pendingPlacement: null });
    } catch {
      /* Keep unsent work visible. Placement remains blocked. */
    }
  };
  return {
    scope: null,
    storageError: null,
    storageReadFailed: false,
    draft: null,
    pendingPlacement: null,
    ordersRevision: 0,
    pickingTableFor: null,
    activateScope: (user, profile) => {
      const scope = draftScope(user, profile);
      if (scope === get().scope) return;
      let saved: SavedDraft = { draft: null, pendingPlacement: null };
      let storageError: string | null = null;
      try {
        const raw = sessionStorage.getItem(scope);
        if (raw) {
          const value = JSON.parse(raw) as SavedDraft;
          if (
            !value ||
            !Object.hasOwn(value, "draft") ||
            !Object.hasOwn(value, "pendingPlacement")
          )
            throw new Error("Invalid draft");
          if (
            value.draft &&
            (value.draft.pos_profile !== profile ||
              !Array.isArray(value.draft.unsent) ||
              !value.draft.header ||
              !value.draft.idempotency_key)
          )
            throw new Error("Invalid draft");
          if (
            value.pendingPlacement &&
            (!value.draft ||
              value.pendingPlacement.key !== value.draft.idempotency_key ||
              value.pendingPlacement.pos_profile !== profile ||
              !Array.isArray(value.pendingPlacement.items) ||
              !value.pendingPlacement.opening)
          )
            throw new Error("Invalid request");
          // Ignore unknown properties rather than spreading browser data into
          // the store (which also contains action functions).
          saved = {
            draft: value.draft,
            pendingPlacement: value.pendingPlacement,
          };
        }
      } catch {
        storageError =
          "The saved restaurant order could not be read. Ask a manager to review open orders before clearing this browser's draft storage.";
      }
      set({
        ...saved,
        scope,
        storageError,
        storageReadFailed: Boolean(storageError),
        pickingTableFor: null,
      });
    },
    setDraft: edit,
    updateDraft: (update) => {
      if (get().draft && !get().pendingPlacement) edit(update(get().draft!));
    },
    beginPlacement: (intent) => {
      if (!get().scope || get().storageReadFailed)
        throw new Error(
          get().storageError || "Wait for your restaurant profile to load."
        );
      if (
        !get().draft ||
        get().draft?.idempotency_key !== intent.key ||
        get().draft?.pos_profile !== intent.pos_profile
      ) {
        throw new Error(
          "The current order changed. Review it before placing it."
        );
      }
      const pendingPlacement =
        get().pendingPlacement ||
        (JSON.parse(JSON.stringify(intent)) as PendingPlacement);
      write({ draft: get().draft, pendingPlacement });
      set({ pendingPlacement });
      return pendingPlacement;
    },
    rememberSession: (session) => {
      const current = get();
      if (!current.pendingPlacement || !current.draft) return;
      const pendingPlacement = { ...current.pendingPlacement, session };
      const draft = { ...current.draft, restaurant_session: session };
      write({ draft, pendingPlacement });
      set({ draft, pendingPlacement });
    },
    finishPlacement: (draft) => {
      write({ draft, pendingPlacement: null });
      set({ draft, pendingPlacement: null });
    },
    rejectPlacement: () => {
      write({ draft: get().draft, pendingPlacement: null });
      set({ pendingPlacement: null });
    },
    markOrdersChanged: () =>
      set((state) => ({ ordersRevision: state.ordersRevision + 1 })),
    setPickingTableFor: (pickingTableFor) => set({ pickingTableFor }),
  };
});
