import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { PosCatalogueItem } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type UsePosItemSearchArgs = {
  customer?: string;
  enabled?: boolean;
  initialItems?: PosCatalogueItem[];
  loadAll?: boolean;
  posProfile: string | undefined;
  priceList?: string;
  query: string;
};

type PosItemSearchResult = {
  cachedItems: PosCatalogueItem[];
  error: string | null;
  hasLoaded: boolean;
  isLoading: boolean;
  isRefreshing?: boolean;
  isStale?: boolean;
  items: PosCatalogueItem[];
  lastUpdated?: number | null;
  reload: () => void | Promise<void>;
};

/**
 * Searches the live, profile-scoped catalogue after a short typing pause.
 *
 * An empty `loadAll` request deliberately asks Frappe for the full catalogue.
 * Bootstrap is capped for a fast first paint, whereas this request becomes the
 * authoritative catalogue once it arrives and must not silently truncate it.
 */
export function usePosItemSearch({
  customer,
  enabled = true,
  initialItems,
  loadAll = false,
  posProfile,
  priceList,
  query,
}: UsePosItemSearchArgs): PosItemSearchResult {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const normalizedQuery = query.trim();

  // Bootstrap rows are the SPA-equivalent local catalogue. They already carry
  // the profile-default rate/UOM/availability, so use them for the default
  // context and only ask the server when the local catalogue cannot answer a
  // non-empty query. Customer or explicit price-list contexts still require a
  // server response because their pricing is contextual.
  const canUseInitialItems = !customer && !priceList;
  const initialMatches = canUseInitialItems
    ? (initialItems ?? []).filter((item) => {
        const needle = normalizedQuery.toLowerCase();
        if (!needle) return true;
        return `${item.item_name} ${item.item_code} ${item.barcode || ""}`
          .toLowerCase()
          .includes(needle);
      })
    : [];

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(normalizedQuery), 300);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  const needsServerRequest = canUseInitialItems
    ? Boolean(debouncedQuery || loadAll) && initialMatches.length === 0
    : Boolean(debouncedQuery || loadAll || initialItems !== undefined);
  const cacheKey =
    companyUrl && sessionId && posProfile && needsServerRequest
      ? {
          query: {
            customer: customer || null,
            limit: loadAll && !debouncedQuery ? 0 : 60,
            priceList: priceList || null,
            query: debouncedQuery,
          },
          resource: "catalogue",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(async (signal: AbortSignal) => {
    if (!companyUrl || !sessionId || !posProfile) {
      throw new Error("Your POS workspace is still loading.");
    }
    try {
      return await getVunaMethod<PosCatalogueItem[]>(
        companyUrl,
        sessionId,
        "vunapos.api.item.search_items",
        {
          limit: loadAll && !debouncedQuery ? 0 : 60,
          customer,
          pos_profile: posProfile,
          price_list: priceList,
          query: debouncedQuery,
        },
        signal,
      );
    } catch (error) {
      if (error instanceof FrappeClientError && error.code === "session") {
        void invalidateSession();
      }
      throw error;
    }
  }, [
    companyUrl,
    customer,
    debouncedQuery,
    invalidateSession,
    loadAll,
    posProfile,
    priceList,
    sessionId,
  ]);
  const resource = usePosCachedResource({
    cacheKey,
    connectionStatus,
    enabled,
    load,
  });

  return {
    cachedItems:
      !debouncedQuery && canUseInitialItems && initialItems !== undefined
        ? initialItems ?? []
        : !debouncedQuery && loadAll
          ? resource.data ?? []
          : [],
    error: resource.error,
    hasLoaded:
      resource.data !== null ||
      (canUseInitialItems && initialItems !== undefined),
    isLoading:
      Boolean(cacheKey) &&
      (normalizedQuery !== debouncedQuery || resource.isLoading),
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    items: resource.data ?? initialMatches,
    lastUpdated: resource.lastUpdated,
    reload: resource.refresh,
  };
}
