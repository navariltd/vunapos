import { useCallback } from "react";

import { navigateToOrder, navigateToPosPage } from "../../../lib/stores/navigationStore";
import type { CachedServiceType } from "../../../lib/types";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import type { BootstrapData } from "../../pos/types";
import { newId } from "../ids";
import { newOrderDraft } from "../orderDraft";
import { useOrderDraftStore } from "../stores/orderDraftStore";

function defaultCustomer(bootstrap: BootstrapData | null): { customer: string | null; customer_name: string | null } {
  const value = bootstrap?.default_customer;
  if (!value) return { customer: null, customer_name: null };
  if (typeof value === "string") return { customer: value, customer_name: value };
  return { customer: value.customer, customer_name: value.customer_name || value.customer };
}

// Starts a new order. A service type that needs a table first sends the user to
// the floor to pick one; the floor then calls startOrder again with the table.
export function useStartOrder() {
  const bootstrap = useBootstrapData();
  const setDraft = useOrderDraftStore((s) => s.setDraft);
  const setPickingTableFor = useOrderDraftStore((s) => s.setPickingTableFor);
  const posProfile = bootstrap.data?.pos_profile;

  return useCallback(
    (serviceType: CachedServiceType, table?: { name: string; table_label: string } | null) => {
      if (!posProfile) return;
      if (serviceType.requires_table && !table) {
        setPickingTableFor(serviceType);
        navigateToPosPage("Floor");
        return;
      }
      setPickingTableFor(null);
      setDraft(
        newOrderDraft({
          pos_profile: posProfile,
          service_type: serviceType.name,
          table: serviceType.requires_table ? (table?.name ?? null) : null,
          table_label: serviceType.requires_table ? (table?.table_label ?? null) : null,
          // The POS Profile's default customer, as checkout would use.
          ...defaultCustomer(bootstrap.data),
          idempotency_key: newId(),
        }),
      );
      navigateToOrder(null);
    },
    [bootstrap.data, posProfile, setDraft, setPickingTableFor],
  );
}
