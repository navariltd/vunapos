import { useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosGatewayPaymentLink } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod, postVunaMethod } from '@/services/frappeClient';

type InitiateGatewayPaymentInput = {
  amount: number;
  currency: string;
  customer?: string;
  idempotencyKey: string;
  modeOfPayment: string;
  phoneNumber: string;
  posProfile: string;
};

/** Starts and checks an online gateway payment; gateway links remain server-authoritative. */
export function useGatewayPayment() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function request<T>(method: string, payload: Record<string, string | number | undefined>, isGet = false): Promise<T | null> {
    if (!companyUrl || !sessionId) {
      setError('Your session is no longer available. Sign in again to continue.');
      return null;
    }
    setError(null);
    setIsWorking(true);
    try {
      return isGet
        ? await getVunaMethod<T>(companyUrl, sessionId, method, payload)
        : await postVunaMethod<T>(companyUrl, sessionId, method, payload);
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') void invalidateSession();
      setError(requestError instanceof Error ? requestError.message : 'Could not contact the payment gateway.');
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  function clearError() {
    setError(null);
  }

  function initiate(input: InitiateGatewayPaymentInput) {
    return request<PosGatewayPaymentLink>('vunapos.api.gateway.initiate_stk_gateway_payment', {
      amount: input.amount,
      currency: input.currency,
      customer: input.customer,
      idempotency_key: input.idempotencyKey,
      mode_of_payment: input.modeOfPayment,
      phone_number: input.phoneNumber,
      pos_profile: input.posProfile,
    });
  }

  function getStatus(gatewayPaymentLink: string) {
    return request<PosGatewayPaymentLink>('vunapos.api.gateway.get_gateway_payment_status', { gateway_payment_link: gatewayPaymentLink }, true);
  }

  function cancel(gatewayPaymentLink: string) {
    return request<PosGatewayPaymentLink>('vunapos.api.gateway.cancel_gateway_payment_link', { gateway_payment_link: gatewayPaymentLink });
  }

  return { cancel, clearError, error, getStatus, initiate, isWorking };
}
