import { useEffect, useRef, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCartItem, PosCheckoutPreview, PosCheckoutResult, PosOrderType } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod, postVunaMethod } from '@/services/frappeClient';

type PreviewInput = {
  customer?: string;
  items: PosCartItem[];
  posProfile?: string;
};

type SubmitInput = PreviewInput & {
  deliveryDate?: string;
  dueDate?: string;
  isCreditSale: boolean;
  orderType: PosOrderType;
  payments: { amount: number; mode_of_payment: string }[];
};

function cartPayload(items: PosCartItem[]) {
  return items.map((item) => ({ item_code: item.item_code, qty: item.qty, uom: item.uom || undefined }));
}

function createIdempotencyKey() {
  return `mobile-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Fetches server-calculated invoice totals before a cashier allocates payment. */
export function usePosCheckoutPreview(input: PreviewInput | null) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const hasInput = Boolean(input);
  const customer = input?.customer;
  const posProfile = input?.posProfile;
  const itemsPayload = input ? JSON.stringify(cartPayload(input.items)) : '';
  const requestKey = hasInput && companyUrl && sessionId && posProfile && input?.items.length
    ? JSON.stringify({ companyUrl, customer, items: itemsPayload, posProfile, sessionId })
    : null;
  const [state, setState] = useState<{ data: PosCheckoutPreview | null; error: string | null; key: string | null }>({ data: null, error: null, key: null });

  useEffect(() => {
    if (!hasInput || !companyUrl || !sessionId || !posProfile || !itemsPayload || !requestKey) return;

    const controller = new AbortController();
    void getVunaMethod<PosCheckoutPreview>(companyUrl, sessionId, 'vunapos.api.sales.preview_invoice', {
      customer,
      items: itemsPayload,
      pos_profile: posProfile,
    }, controller.signal)
      .then((data) => setState({ data, error: null, key: requestKey }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (requestError instanceof FrappeClientError && requestError.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({ data: null, error: requestError instanceof Error ? requestError.message : 'Could not calculate this sale.', key: requestKey });
      });
    return () => controller.abort();
  }, [companyUrl, customer, hasInput, invalidateSession, itemsPayload, posProfile, requestKey, sessionId]);

  return {
    data: state.key === requestKey ? state.data : null,
    error: state.key === requestKey ? state.error : null,
    isLoading: Boolean(requestKey && state.key !== requestKey),
  };
}

/** Submits an online-only sale with one stable idempotency key per checkout attempt. */
export function useSubmitPosCheckout() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  function clearError() {
    setError(null);
  }

  async function submit(input: SubmitInput): Promise<PosCheckoutResult | null> {
    if (!companyUrl || !sessionId || !input.posProfile) {
      setError('Your session is no longer available. Sign in again to continue.');
      return null;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await postVunaMethod<PosCheckoutResult>(
        companyUrl,
        sessionId,
        input.orderType === 'Order' ? 'vunapos.api.sales.create_and_submit_sales_order' : 'vunapos.api.sales.create_and_submit_invoice',
        {
          customer: input.customer,
          idempotency_key: idempotencyKey.current,
          items: JSON.stringify(cartPayload(input.items)),
          payments: JSON.stringify(input.payments),
          pos_profile: input.posProfile,
          ...(input.orderType === 'Invoice' && input.isCreditSale
            ? { due_date: input.dueDate, is_credit_sale: true }
            : {}),
          ...(input.orderType === 'Order' ? { delivery_date: input.deliveryDate } : {}),
        },
      );
      idempotencyKey.current = createIdempotencyKey();
      return result;
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        void invalidateSession();
      }
      setError(requestError instanceof Error ? requestError.message : 'Could not complete this sale.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { clearError, error, isSubmitting, submit };
}
