import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  PosCustomerDirectory,
  PosCustomerDirectoryFilters,
} from "@/features/pos/types";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

const CUSTOMER_DIRECTORY_PAGE_SIZE = 25;
const initialFilters: PosCustomerDirectoryFilters = {
  customerGroup: "",
  customerType: "",
  territory: "",
};

type PosCustomerDirectoryState = {
  data: PosCustomerDirectory | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  lastUpdated: number | null;
  reload: () => void | Promise<void>;
};

/** Cached, permission-filtered customer pages. Customer writes remain live-only. */
export function usePosCustomerDirectory(
  posProfile: string | undefined,
  query = "",
  filters: PosCustomerDirectoryFilters = initialFilters,
  start = 0,
): PosCustomerDirectoryState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sessionInvalid, setSessionInvalid] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const cacheKey =
    companyUrl && sessionId && posProfile
      ? {
          query: {
            customerGroup: filters.customerGroup,
            customerType: filters.customerType,
            query: debouncedQuery,
            start,
            territory: filters.territory,
          },
          resource: "customer-directory",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!companyUrl || !sessionId || !posProfile) {
        throw new Error("Your POS workspace is still loading.");
      }
      try {
        return await getVunaMethod<PosCustomerDirectory>(
          companyUrl,
          sessionId,
          "vunapos.api.customer.get_customer_directory",
          {
            limit: CUSTOMER_DIRECTORY_PAGE_SIZE,
            customer_group: filters.customerGroup,
            customer_type: filters.customerType,
            pos_profile: posProfile,
            query: debouncedQuery,
            start,
            territory: filters.territory,
          },
          signal,
        );
      } catch (error) {
        if (error instanceof FrappeClientError && error.code === "session") {
          setSessionInvalid(true);
          void invalidateSession();
        }
        throw error;
      }
    },
    [companyUrl, debouncedQuery, filters, invalidateSession, posProfile, sessionId, start],
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
