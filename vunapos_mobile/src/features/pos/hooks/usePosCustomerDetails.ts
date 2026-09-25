import { useCallback, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosCustomerDetails } from "@/features/pos/types";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type PosCustomerDetailsState = {
  data: PosCustomerDetails | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing?: boolean;
  isStale?: boolean;
  lastUpdated?: number | null;
  reload: () => void | Promise<void>;
};

type UsePosCustomerDetailsArgs = {
  customer: string;
  posProfile: string | undefined;
};

function isPosCustomerDetails(value: unknown): value is PosCustomerDetails {
  if (!value || typeof value !== "object") return false;

  const details = value as Record<string, unknown>;
  const customer = details.customer;
  if (!customer || typeof customer !== "object") return false;

  const customerSummary = customer as Record<string, unknown>;
  return (
    typeof details.as_of === "string" &&
    typeof details.balance === "number" &&
    typeof customerSummary.customer === "string" &&
    typeof customerSummary.customer_name === "string" &&
    (details.loyalty === null || typeof details.loyalty === "object")
  );
}

/** Cached, readonly customer profile. Customer mutations stay server-authoritative. */
export function usePosCustomerDetails({
  customer,
  posProfile,
}: UsePosCustomerDetailsArgs): PosCustomerDetailsState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const cacheKey =
    companyUrl && sessionId && posProfile && customer
      ? {
          query: { customer },
          resource: "customer-details",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!companyUrl || !sessionId || !posProfile || !customer) {
        throw new Error("Your POS workspace is still loading.");
      }
      try {
        const data = await getVunaMethod<unknown>(
          companyUrl,
          sessionId,
          "vunapos.api.customer.get_customer_details",
          { customer, pos_profile: posProfile },
          signal,
        );
        if (!isPosCustomerDetails(data)) {
          throw new Error("The server returned incomplete customer details.");
        }
        return data;
      } catch (error) {
        if (error instanceof FrappeClientError && error.code === "session") {
          setSessionInvalid(true);
          void invalidateSession();
        }
        throw error;
      }
    },
    [companyUrl, customer, invalidateSession, posProfile, sessionId],
  );
  const resource = usePosCachedResource({ cacheKey, connectionStatus, load });

  return {
    data: resource.data,
    error: sessionInvalid ? null : resource.error,
    isLoading: resource.isLoading,
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    lastUpdated: resource.lastUpdated,
    reload: resource.refresh,
  };
}
