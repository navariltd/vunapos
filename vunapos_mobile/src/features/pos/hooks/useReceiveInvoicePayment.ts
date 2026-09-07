import { useRef, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosReceivedPayment } from '@/features/pos/types';
import { FrappeClientError, postVunaMethod } from '@/services/frappeClient';

type ReceiveInvoicePaymentInput = {
  amount: number;
  customer: string;
  invoice: string;
  modeOfPayment: string;
  posProfile: string;
  referenceDate?: string;
  referenceNo?: string;
};

function createIdempotencyKey() {
  return `mobile-payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Submits one invoice allocation at a time with a stable retry-safe key. */
export function useReceiveInvoicePayment() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  async function receive(input: ReceiveInvoicePaymentInput): Promise<PosReceivedPayment | null> {
    if (!companyUrl || !sessionId) {
      setError('Your session is no longer available. Sign in again to continue.');
      return null;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const payment = await postVunaMethod<PosReceivedPayment>(
        companyUrl,
        sessionId,
        'vunapos.api.payment.receive_customer_payment',
        {
          allocated_amount: input.amount,
          amount: input.amount,
          customer: input.customer,
          idempotency_key: idempotencyKey.current,
          mode_of_payment: input.modeOfPayment,
          pos_profile: input.posProfile,
          reference_date: input.referenceDate,
          reference_no: input.referenceNo,
          sales_invoice: input.invoice,
        },
      );
      idempotencyKey.current = createIdempotencyKey();
      return payment;
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        void invalidateSession();
      }
      setError(requestError instanceof Error ? requestError.message : 'Could not receive the payment.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { error, isSubmitting, receive };
}
