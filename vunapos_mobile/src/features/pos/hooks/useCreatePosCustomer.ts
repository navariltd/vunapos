import { useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useNetworkStatus } from '@/services/NetworkStatusProvider';
import { PosCustomerSearchResult } from '@/features/pos/types';
import { FrappeClientError, postVunaMethod } from '@/services/frappeClient';
import { invalidateCustomerDirectoryCache } from '@/services/posCacheInvalidation';

type CustomerResponse = {
  customer: string;
  customer_name: string;
  default_price_list?: string | null;
  email_id?: string | null;
  is_walkin?: boolean;
  mobile_no?: string | null;
  tax_id?: string | null;
};

/** Creates a permitted customer through Frappe; the server remains the authority for access. */
export function useCreatePosCustomer() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function create(customerName: string, posProfile?: string): Promise<PosCustomerSearchResult | null> {
    if (connectionStatus === 'offline') {
      setError('Connection unavailable. Reconnect before creating a customer.');
      return null;
    }
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setError('Enter a customer name.');
      return null;
    }
    if (!companyUrl || !sessionId || !posProfile) {
      setError('Your POS session is not ready. Try again once the workspace has loaded.');
      return null;
    }

    setError(null);
    setIsCreating(true);
    try {
      const customer = await postVunaMethod<CustomerResponse>(companyUrl, sessionId, 'vunapos.api.customer.create_customer', {
        customer_name: trimmedName,
        pos_profile: posProfile,
      });
      await invalidateCustomerDirectoryCache({ companyUrl, posProfile, sessionId });
      return {
        customer: customer.customer,
        customerName: customer.customer_name,
        defaultPriceList: customer.default_price_list,
        email: customer.email_id,
        ...(customer.is_walkin ? { isWalkin: true } : {}),
        mobile: customer.mobile_no,
        taxId: customer.tax_id,
      };
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        void invalidateSession();
      }
      setError(requestError instanceof Error ? requestError.message : 'Could not create the customer.');
      return null;
    } finally {
      setIsCreating(false);
    }
  }

  return { create, error, isCreating };
}
