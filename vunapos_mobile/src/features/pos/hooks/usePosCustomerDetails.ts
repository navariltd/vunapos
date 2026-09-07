import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCustomerDetails } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type PosCustomerDetailsState = {
  data: PosCustomerDetails | null;
  error: string | null;
  isLoading: boolean;
};

type PosCustomerDetailsRequestState = Omit<PosCustomerDetailsState, 'isLoading'> & {
  requestKey: string | null;
};

type UsePosCustomerDetailsArgs = {
  customer: string;
  posProfile: string | undefined;
};

/** Fetches only the permission-filtered customer profile exposed by VunaPOS. */
export function usePosCustomerDetails({ customer, posProfile }: UsePosCustomerDetailsArgs): PosCustomerDetailsState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const requestKey = companyUrl && sessionId && posProfile && customer
    ? JSON.stringify({ companyUrl, customer, posProfile, sessionId })
    : null;
  const [state, setState] = useState<PosCustomerDetailsRequestState>({ data: null, error: null, requestKey: null });

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile || !customer) {
      return;
    }

    const controller = new AbortController();

    void getVunaMethod<PosCustomerDetails>(companyUrl, sessionId, 'vunapos.api.customer.get_customer_details', {
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
        setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Could not load customer details.', requestKey }));
      });

    return () => controller.abort();
  }, [companyUrl, customer, invalidateSession, posProfile, requestKey, sessionId]);

  if (!requestKey) {
    return { data: null, error: null, isLoading: false };
  }

  return { ...state, error: state.requestKey === requestKey ? state.error : null, isLoading: state.requestKey !== requestKey };
}
