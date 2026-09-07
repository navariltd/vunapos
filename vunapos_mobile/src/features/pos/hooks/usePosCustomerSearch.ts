import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCustomerSearchResult } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type CustomerResponse = {
  customer: string;
  customer_name: string;
  email_id?: string | null;
  mobile_no?: string | null;
};

/** Searches only customers the signed-in Frappe user is permitted to use. */
export function usePosCustomerSearch(query: string, enabled: boolean) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [state, setState] = useState<{ error: string | null; key: string | null; rows: PosCustomerSearchResult[] }>({ error: null, key: null, rows: [] });
  const requestKey = enabled && companyUrl && sessionId ? `${companyUrl}:${sessionId}:${debouncedQuery}` : null;

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [enabled, query]);

  useEffect(() => {
    if (!companyUrl || !sessionId || !requestKey) return;
    const controller = new AbortController();
    void getVunaMethod<CustomerResponse[]>(companyUrl, sessionId, 'vunapos.api.customer.search_customers', {
      limit: 20,
      query: debouncedQuery,
    }, controller.signal)
      .then((rows) => setState({ error: null, key: requestKey, rows: rows.map((row) => ({ customer: row.customer, customerName: row.customer_name, email: row.email_id, mobile: row.mobile_no })) }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (requestError instanceof FrappeClientError && requestError.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({ error: requestError instanceof Error ? requestError.message : 'Could not load customers.', key: requestKey, rows: [] });
      });
    return () => controller.abort();
  }, [companyUrl, debouncedQuery, invalidateSession, requestKey, sessionId]);

  return {
    error: state.key === requestKey ? state.error : null,
    isLoading: Boolean(requestKey && state.key !== requestKey),
    rows: state.key === requestKey ? state.rows : [],
  };
}
