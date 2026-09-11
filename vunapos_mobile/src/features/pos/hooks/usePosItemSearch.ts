import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCatalogueItem } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type UsePosItemSearchArgs = {
  posProfile: string | undefined;
  query: string;
};

type ItemSearchState = {
  error: string | null;
  items: PosCatalogueItem[];
  requestKey: string | null;
};

/** Searches the live, profile-scoped catalogue after a short typing pause. */
export function usePosItemSearch({ posProfile, query }: UsePosItemSearchArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [state, setState] = useState<ItemSearchState>({ error: null, items: [], requestKey: null });
  const normalizedQuery = query.trim();
  const requestKey = companyUrl && sessionId && posProfile && debouncedQuery
    ? JSON.stringify({ companyUrl, debouncedQuery, posProfile, sessionId })
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
      pos_profile: posProfile,
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
  }, [companyUrl, debouncedQuery, invalidateSession, posProfile, requestKey, sessionId]);

  return {
    error: state.requestKey === requestKey ? state.error : null,
    isLoading: Boolean(normalizedQuery) && (normalizedQuery !== debouncedQuery || state.requestKey !== requestKey),
    items: state.requestKey === requestKey ? state.items : [],
  };
}
