import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCustomerShippingAddress } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type PosCustomerShippingAddressesState = {
  data: PosCustomerShippingAddress[] | null;
  error: string | null;
  isLoading: boolean;
};

type PosCustomerShippingAddressesRequestState = Omit<PosCustomerShippingAddressesState, 'isLoading'> & {
  requestKey: string | null;
};

/** Fetches the customer-linked addresses that Frappe permits for checkout. */
export function usePosCustomerShippingAddresses(
  customer: string | undefined,
  posProfile: string | undefined,
): PosCustomerShippingAddressesState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const requestKey = companyUrl && sessionId && customer && posProfile
    ? `${companyUrl}:${sessionId}:${posProfile}:${customer}`
    : null;
  const [state, setState] = useState<PosCustomerShippingAddressesRequestState>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (!companyUrl || !sessionId || !customer || !posProfile || !requestKey) return;
    const controller = new AbortController();
    void getVunaMethod<PosCustomerShippingAddress[]>(
      companyUrl,
      sessionId,
      'vunapos.api.customer.get_customer_addresses',
      { customer, limit: 100, pos_profile: posProfile },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({
          data: null,
          error: error instanceof Error ? error.message : 'Shipping addresses are unavailable.',
          requestKey,
        });
      });
    return () => controller.abort();
  }, [companyUrl, customer, invalidateSession, posProfile, requestKey, sessionId]);

  if (!requestKey) return { data: null, error: null, isLoading: false };
  return {
    ...state,
    error: state.requestKey === requestKey ? state.error : null,
    isLoading: state.requestKey !== requestKey,
  };
}
