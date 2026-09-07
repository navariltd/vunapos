import { useRef, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCreatedInvoiceReturn } from '@/features/pos/types';
import { FrappeClientError, postVunaMethod } from '@/services/frappeClient';

type CreateInvoiceReturnInput = {
  invoiceName: string;
  items: { qty: number; row_name: string }[];
  posProfile: string;
  reason: string;
};

function createIdempotencyKey() {
  return `mobile-return-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Creates one retry-safe credit note from server-validated invoice rows. */
export function useCreateInvoiceReturn() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  async function create(input: CreateInvoiceReturnInput): Promise<PosCreatedInvoiceReturn | null> {
    if (!companyUrl || !sessionId) {
      setError('Your session is no longer available. Sign in again to continue.');
      return null;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await postVunaMethod<PosCreatedInvoiceReturn>(
        companyUrl,
        sessionId,
        'vunapos.api.sales.create_invoice_return',
        {
          idempotency_key: idempotencyKey.current,
          invoice_name: input.invoiceName,
          items: JSON.stringify(input.items),
          pos_profile: input.posProfile,
          reason: input.reason,
        },
      );
      idempotencyKey.current = createIdempotencyKey();
      return result;
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        void invalidateSession();
      }
      setError(requestError instanceof Error ? requestError.message : 'Could not create the credit note.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { create, error, isSubmitting };
}
