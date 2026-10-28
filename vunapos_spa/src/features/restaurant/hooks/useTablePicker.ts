import { useCallback, useState } from "react";

import { navigateToOrder } from "../../../lib/stores/navigationStore";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import type { ConflictPrompt } from "../components/ConflictDialog";
import { floorConflicts, missingFromMenu } from "../menuConflicts";
import { chooseTable, mergeIntoOrder, removeUnsentLines, type OrderDraft } from "../orderDraft";
import { describeOrderError } from "../orderErrors";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { MenuDTO, RestaurantTableDTO } from "../types";
import { useMenuFetcher, useOrderFetcher } from "./useOrderData";

// Choosing a table on the floor for the order being built. A free table (or a
// separate order on an occupied one) is checked against the floor's menu; adding
// to an open order is checked against that order's menu. Conflicting lines are
// listed with "Remove these items" or a way back; nothing else is blocked.
export function useTablePicker(posProfile: string | undefined, pickerMenu: MenuDTO | null) {
  const fetchMenu = useMenuFetcher(posProfile);
  const fetchOrder = useOrderFetcher();
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const [conflict, setConflict] = useState<ConflictPrompt | null>(null);
  const [busy, setBusy] = useState(false);

  // Back to the order with the table set, sending it if Send asked for the table.
  const finish = useCallback((next: OrderDraft) => {
    const store = useOrderDraftStore.getState();
    store.setDraft(next);
    store.setSendOnArrival(store.picking?.then === "send");
    store.setPicking(null);
    navigateToOrder(null);
  }, []);

  const pickTable = useCallback(
    (table: Pick<RestaurantTableDTO, "name" | "table_label" | "floor">) => {
      const draft = useOrderDraftStore.getState().draft;
      if (!draft) return;
      const conflicts = pickerMenu ? floorConflicts(draft.unsent, pickerMenu, table.floor) : [];
      if (!conflicts.length) {
        finish(chooseTable(draft, table));
        return;
      }
      setConflict({
        title: `Not served at ${table.table_label}`,
        description: `These items aren't served on this table's floor.`,
        lines: conflicts,
        otherLabel: "Choose another table",
        onRemove: () => {
          const current = useOrderDraftStore.getState().draft;
          if (current) finish(chooseTable(removeUnsentLines(current, conflicts.map((line) => line.line_id)), table));
        },
      });
    },
    [finish, pickerMenu],
  );

  const addToOrder = useCallback(
    async (orderName: string) => {
      setBusy(true);
      try {
        const target = await fetchOrder(orderName);
        if (target.status !== "Open") {
          showToast({ type: "error", message: `${target.name} is ${target.status.toLowerCase()} and can't take more items.` });
          return false;
        }
        const menu = await fetchMenu(target.service_type, target.table);
        const draft = useOrderDraftStore.getState().draft;
        if (!draft) return false;
        const merge = (lineIds: string[]) => {
          const current = useOrderDraftStore.getState().draft;
          if (!current) return;
          const { draft: merged, droppedNote } = mergeIntoOrder(removeUnsentLines(current, lineIds), target);
          const store = useOrderDraftStore.getState();
          store.setDraft(merged);
          store.setPicking(null);
          // Sent as a new round as soon as the order screen shows it.
          store.setSendOnArrival(true);
          navigateToOrder(target.name);
          if (droppedNote) {
            showToast({ type: "info", message: `${target.name} already has an order note, so yours wasn't added.` });
          }
        };
        const conflicts = missingFromMenu(draft.unsent, menu);
        if (!conflicts.length) {
          merge([]);
          return true;
        }
        setConflict({
          title: `Not available on ${target.name}`,
          description: `These items aren't on the menu for ${target.table_label ? `table ${target.table_label}` : target.service_type}.`,
          lines: conflicts,
          otherLabel: "Choose another table",
          onRemove: () => merge(conflicts.map((line) => line.line_id)),
        });
        return true;
      } catch (caught) {
        showToast({ type: "error", message: describeOrderError(caught as Error, "The order could not be loaded.").message });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fetchMenu, fetchOrder, showToast],
  );

  return { pickTable, addToOrder, conflict, clearConflict: () => setConflict(null), busy };
}
