import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosInvoiceHistory, PosInvoiceHistoryFilters } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

const pageLength = 25;

type PosInvoiceHistoryState = {
  data: PosInvoiceHistory | null;
  error: string | null;
  isLoading: boolean;
};

type PosInvoiceHistoryRequestState = Omit<PosInvoiceHistoryState, 'isLoading'> & {
  requestKey: string | null;
};

type UsePosInvoiceHistoryArgs = {
  filters: PosInvoiceHistoryFilters;
  posProfile: string | undefined;
  start: number;
};

export function usePosInvoiceHistory({ filters, posProfile, start }: UsePosInvoiceHistoryArgs): PosInvoiceHistoryState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const requestKey = companyUrl && sessionId && posProfile
    ? JSON.stringify({ companyUrl, filters, posProfile, sessionId, start })
    : null;
  const [state, setState] = useState<PosInvoiceHistoryRequestState>({ data: null, error: null, requestKey: null });

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile) {
      return;
    }

    const controller = new AbortController();

    void getVunaMethod<PosInvoiceHistory>(companyUrl, sessionId, 'vunapos.api.sales.get_invoice_history', {
      current_shift: filters.currentShift ? 1 : 0,
      customer: filters.customer.trim(),
      document_type: filters.documentType,
      from_date: filters.fromDate,
      invoice: filters.invoice.trim(),
      page_length: pageLength,
      payment_mode: filters.paymentMode,
      pos_profile: posProfile,
      sale_type: filters.saleType,
      start,
      status: filters.status,
      to_date: filters.toDate,
    }, controller.signal)
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === 'session') {
          void invalidateSession();
          return;
        }
        setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Could not load invoice history.', requestKey }));
      });

    return () => controller.abort();
  }, [companyUrl, filters, invalidateSession, posProfile, requestKey, sessionId, start]);

  if (!requestKey) {
    return { data: null, error: null, isLoading: false };
  }

  return { ...state, error: state.requestKey === requestKey ? state.error : null, isLoading: state.requestKey !== requestKey };
}
