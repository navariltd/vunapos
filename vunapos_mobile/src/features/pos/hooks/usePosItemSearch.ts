import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosCatalogueItem } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type UsePosItemSearchArgs = {
  customer?: string;
  enabled?: boolean;
  loadAll?: boolean;
  posProfile: string | undefined;
  priceList?: string;
  query: string;
};

type ItemSearchState = {
  cachedItems: PosCatalogueItem[];
  catalogueKey: string | null;
  error: string | null;
  items: PosCatalogueItem[];
  requestKey: string | null;
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
  loadAll = false,
  posProfile,
  priceList,
  query,
}: UsePosItemSearchArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ItemSearchState>({
    cachedItems: [],
    catalogueKey: null,
    error: null,
    items: [],
    requestKey: null,
  });
  const normalizedQuery = query.trim();
  const catalogueKey =
    companyUrl && sessionId && posProfile
      ? JSON.stringify({ companyUrl, customer, posProfile, priceList, sessionId })
      : null;
  const requestKey =
    enabled && companyUrl && sessionId && posProfile && (debouncedQuery || loadAll)
      ? JSON.stringify({
          companyUrl,
          customer,
          debouncedQuery,
          posProfile,
          priceList,
          reloadKey,
          sessionId,
        })
      : null;

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(normalizedQuery), 300);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!requestKey || !companyUrl || !sessionId || !posProfile) return;
    const controller = new AbortController();

    void getVunaMethod<PosCatalogueItem[]>(
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
      controller.signal,
    )
      .then((items) =>
        setState((current) => ({
          cachedItems:
            !debouncedQuery && loadAll ? items : current.cachedItems,
          catalogueKey:
            !debouncedQuery && loadAll ? catalogueKey : current.catalogueKey,
          error: null,
          items,
          requestKey,
        })),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === "session") {
          void invalidateSession();
          return;
        }
        setState((current) => ({
          cachedItems: current.cachedItems,
          catalogueKey: current.catalogueKey,
          error:
            error instanceof Error
              ? error.message
              : "Could not search the item catalogue.",
          items: current.items,
          requestKey,
        }));
      });

    return () => controller.abort();
  }, [
    catalogueKey,
    companyUrl,
    customer,
    debouncedQuery,
    enabled,
    invalidateSession,
    loadAll,
    posProfile,
    priceList,
    reloadKey,
    requestKey,
    sessionId,
  ]);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  return {
    cachedItems:
      state.catalogueKey === catalogueKey ? state.cachedItems : [],
    error: state.requestKey === requestKey ? state.error : null,
    hasLoaded: state.requestKey === requestKey,
    isLoading:
      Boolean(requestKey) &&
      (normalizedQuery !== debouncedQuery || state.requestKey !== requestKey),
    items: state.requestKey === requestKey ? state.items : [],
    reload,
  };
}
