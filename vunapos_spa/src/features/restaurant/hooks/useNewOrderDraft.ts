import { useCallback } from "react";

import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import type { BootstrapData } from "../../pos/types";
import { newId } from "../ids";
import { defaultServiceType, newOrderDraft, type OrderDraft } from "../orderDraft";

function defaultCustomer(bootstrap: BootstrapData | null): { customer: string | null; customer_name: string | null } {
  const value = bootstrap?.default_customer;
  if (!value) return { customer: null, customer_name: null };
  if (typeof value === "string") return { customer: value, customer_name: value };
  return { customer: value.customer, customer_name: value.customer_name || value.customer };
}

// Builds the empty order the screen opens on: the profile's default service type
// (none when it has no default), its default customer, and no table.
export function useNewOrderDraft() {
  const bootstrap = useBootstrapData();
  return useCallback((): OrderDraft | null => {
    const data = bootstrap.data;
    if (!data?.pos_profile) return null;
    return newOrderDraft({
      pos_profile: data.pos_profile,
      service_type: defaultServiceType(data.restaurant?.service_types ?? [])?.name ?? null,
      ...defaultCustomer(data),
      idempotency_key: newId(),
    });
  }, [bootstrap.data]);
}
