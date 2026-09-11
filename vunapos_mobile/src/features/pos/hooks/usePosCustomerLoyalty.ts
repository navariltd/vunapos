import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCustomerLoyalty } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type PosCustomerLoyaltyState = {
  data: PosCustomerLoyalty | null;
  error: string | null;
  isLoading: boolean;
};

type PosCustomerLoyaltyRequestState = Omit<PosCustomerLoyaltyState, 'isLoading'> & {
  requestKey: string | null;
};

/** Fetches the customer's live loyalty balance and redemption conversion from ERPNext. */
export function usePosCustomerLoyalty(customer: string | undefined, posProfile: string | undefined): PosCustomerLoyaltyState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const requestKey = companyUrl && sessionId && customer && posProfile ? `${companyUrl}:${sessionId}:${posProfile}:${customer}` : null;
  const [state, setState] = useState<PosCustomerLoyaltyRequestState>({ data: null, error: null, requestKey: null });

  useEffect(() => {
    if (!companyUrl || !sessionId || !customer || !posProfile || !requestKey) return;
    const controller = new AbortController();
    void getVunaMethod<PosCustomerLoyalty>(companyUrl, sessionId, 'vunapos.api.customer.get_customer_loyalty', {
      customer,
      pos_profile: posProfile,
    }, controller.signal)
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({ data: null, error: error instanceof Error ? error.message : 'Loyalty balance is unavailable.', requestKey });
      });
    return () => controller.abort();
  }, [companyUrl, customer, invalidateSession, posProfile, requestKey, sessionId]);

  if (!requestKey) return { data: null, error: null, isLoading: false };
  return { ...state, error: state.requestKey === requestKey ? state.error : null, isLoading: state.requestKey !== requestKey };
}
