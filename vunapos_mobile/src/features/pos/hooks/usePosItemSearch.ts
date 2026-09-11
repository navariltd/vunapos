import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCatalogueItem } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type UsePosItemSearchArgs = {
  customer?: string;
  loadAll?: boolean;
  posProfile: string | undefined;
  priceList?: string;
  query: string;
};

type ItemSearchState = {
  error: string | null;
  items: PosCatalogueItem[];
  requestKey: string | null;
};

/** Searches the live, profile-scoped catalogue after a short typing pause. */
export function usePosItemSearch({ customer, loadAll = false, posProfile, priceList, query }: UsePosItemSearchArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [state, setState] = useState<ItemSearchState>({ error: null, items: [], requestKey: null });
  const normalizedQuery = query.trim();
  const requestKey = companyUrl && sessionId && posProfile && (debouncedQuery || loadAll)
    ? JSON.stringify({ companyUrl, customer, debouncedQuery, posProfile, priceList, sessionId })
    : null;

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(normalizedQuery), 300);
    return () => clearTimeout(timeout);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!requestKey || !companyUrl || !sessionId || !posProfile) return;
    const controller = new AbortController();

    void getVunaMethod<PosCatalogueItem[]>(companyUrl, sessionId, 'vunapos.api.item.search_items', {
      limit: 60,
      customer,
      pos_profile: posProfile,
      price_list: priceList,
      query: debouncedQuery,
    }, controller.signal)
      .then((items) => setState({ error: null, items, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({ error: error instanceof Error ? error.message : 'Could not search the item catalogue.', items: [], requestKey });
      });

    return () => controller.abort();
  }, [companyUrl, customer, debouncedQuery, invalidateSession, posProfile, priceList, requestKey, sessionId]);

  return {
    error: state.requestKey === requestKey ? state.error : null,
    hasLoaded: state.requestKey === requestKey,
    isLoading: Boolean(requestKey) && (normalizedQuery !== debouncedQuery || state.requestKey !== requestKey),
    items: state.requestKey === requestKey ? state.items : [],
  };
}
