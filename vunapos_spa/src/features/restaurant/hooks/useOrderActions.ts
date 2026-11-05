import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
  navigateToOrder,
  navigateToRestaurantSession,
} from "../../../lib/stores/navigationStore";
import {
  VunaApiError,
  addRestaurantOrderItems,
  openRestaurantSession,
  createSessionRound,
  getRestaurantOrder,
  previewRestaurantOrder,
  updateRestaurantOrder,
  updateRestaurantOrderItem,
  vunaMethods,
} from "../../../services/vunaApi";
import { planSave, withServerOrder, type SaveStep } from "../orderDraft";
import { describeOrderError, type OrderErrorView } from "../orderErrors";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { OrderPreviewDTO, RestaurantOrderDTO } from "../types";

// Loading, saving and previewing the order in the draft store. Save sends the
// planned steps one by one; after each success the draft is rebuilt from the
// server's order, so a failure part-way leaves only the unsent part pending.
export function useOrderActions({
  onMenuChanged,
}: { onMenuChanged?: () => void } = {}) {
  const sessionCall = useFrappePostCall(vunaMethods.openRestaurantSession);
  const roundCall = useFrappePostCall(vunaMethods.createSessionRound);
  const updateCall = useFrappePostCall(vunaMethods.updateRestaurantOrder);
  const addCall = useFrappePostCall(vunaMethods.addRestaurantOrderItems);
  const updateItemCall = useFrappePostCall(
    vunaMethods.updateRestaurantOrderItem
  );
  const getCall = useFrappePostCall(vunaMethods.getRestaurantOrder);
  const previewCall = useFrappePostCall(vunaMethods.previewRestaurantOrder);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<OrderErrorView | null>(null);

  const runStep = useCallback(
    async (step: SaveStep): Promise<RestaurantOrderDTO> => {
      switch (step.kind) {
        case "create": {
          const p = step.params;
          const session = await openRestaurantSession(sessionCall.call, {
            pos_profile: p.pos_profile,
            idempotency_key: `session:${p.idempotency_key}`,
            tables: p.table ? [p.table] : [],
            service_type: p.service_type,
            customer: p.customer,
            guest_count: p.pax,
          });
          return createSessionRound(roundCall.call, {
            session: session.name,
            items: p.items,
            idempotency_key: p.idempotency_key,
            order_note: p.order_note,
          });
        }
        case "update_order":
          return updateRestaurantOrder(updateCall.call, step.params);
        case "add_items":
          return addRestaurantOrderItems(addCall.call, step.params);
        case "update_item":
          return updateRestaurantOrderItem(updateItemCall.call, step.params);
      }
    },
    [
      addCall.call,
      sessionCall.call,
      roundCall.call,
      updateCall.call,
      updateItemCall.call,
    ]
  );

  const load = useCallback(
    async (order: string) => {
      const loaded = await getRestaurantOrder(getCall.call, order);
      const { draft, setDraft } = useOrderDraftStore.getState();
      setDraft(withServerOrder(draft, loaded));
      return loaded;
    },
    [getCall.call]
  );

  const save = useCallback(async (): Promise<boolean> => {
    const store = useOrderDraftStore.getState();
    if (!store.draft) return false;
    const steps = planSave(store.draft);
    if (!steps.length) return true;
    setSaving(true);
    setError(null);
    let changed = false;
    try {
      for (const step of steps) {
        const order = await runStep(step);
        changed = true;
        const current = useOrderDraftStore.getState().draft;
        useOrderDraftStore.getState().setDraft(withServerOrder(current, order));
        if (step.kind === "create") {
          if (order.restaurant_session)
            navigateToRestaurantSession(order.restaurant_session, {
              replace: true,
            });
          else navigateToOrder(order.name, { replace: true });
        }
      }
      return true;
    } catch (caught) {
      const view = describeOrderError(
        caught instanceof VunaApiError ? caught : (caught as Error)
      );
      if (view.action === "reload-menu") {
        // Take the item off the waiting lines, then offer the current menu.
        if (view.itemCode) {
          useOrderDraftStore.getState().updateDraft((draft) => ({
            ...draft,
            unsent: draft.unsent.filter(
              (line) => line.item_code !== view.itemCode
            ),
          }));
        }
        onMenuChanged?.();
      }
      if (view.action === "reload-order") {
        const name = useOrderDraftStore.getState().draft?.order?.name;
        if (name) await load(name).catch(() => undefined);
      }
      setError(view);
      return false;
    } finally {
      setSaving(false);
      if (changed) useOrderDraftStore.getState().markOrdersChanged();
    }
  }, [load, onMenuChanged, runStep]);

  const preview = useCallback(
    (order: string): Promise<OrderPreviewDTO> =>
      previewRestaurantOrder(previewCall.call, order),
    [previewCall.call]
  );

  return {
    save,
    load,
    preview,
    saving,
    error,
    clearError: () => setError(null),
  };
}
