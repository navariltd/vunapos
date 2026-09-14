import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type CustomerResponse = {
  customer: string;
  customer_name: string;
  default_price_list?: string | null;
  email_id?: string | null;
  is_walkin?: boolean;
  mobile_no?: string | null;
  tax_id?: string | null;
};

/** Cached customer lookups, scoped to the active POS workspace and user. */
export function usePosCustomerSearch(
  query: string,
  enabled: boolean,
  posProfile?: string,
) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [sessionInvalid, setSessionInvalid] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [enabled, query]);

  const cacheKey =
    companyUrl && sessionId && posProfile
      ? {
          query: { query: debouncedQuery },
          resource: "customer-search",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!companyUrl || !sessionId) {
        throw new Error("Your POS workspace is still loading.");
      }
      try {
        const rows = await getVunaMethod<CustomerResponse[]>(
          companyUrl,
          sessionId,
          "vunapos.api.customer.search_customers",
          { limit: 20, query: debouncedQuery },
          signal,
        );
        return rows.map((row) => ({
          customer: row.customer,
          customerName: row.customer_name,
          defaultPriceList: row.default_price_list,
          email: row.email_id,
          mobile: row.mobile_no,
          ...(row.is_walkin ? { isWalkin: true } : {}),
          ...(row.tax_id ? { taxId: row.tax_id } : {}),
        }));
      } catch (error) {
        if (error instanceof FrappeClientError && error.code === "session") {
          setSessionInvalid(true);
          void invalidateSession();
        }
        throw error;
      }
    },
    [companyUrl, debouncedQuery, invalidateSession, sessionId],
  );
  const resource = usePosCachedResource({
    cacheKey,
    connectionStatus,
    enabled,
    load,
  });

  return {
    error: sessionInvalid ? null : resource.error,
    isLoading: resource.isLoading,
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    lastUpdated: resource.lastUpdated,
    reload: resource.refresh,
    rows: resource.data ?? [],
  };
}
