import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosInvoiceReturnPreview } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type UseInvoiceReturnPreviewArgs = {
  enabled: boolean;
  invoiceName: string;
  posProfile: string | undefined;
};

type ReturnPreviewState = {
  data: PosInvoiceReturnPreview | null;
  error: string | null;
  isLoading: boolean;
};

/** Loads the server-calculated remaining quantities before a return can be drafted. */
export function useInvoiceReturnPreview({ enabled, invoiceName, posProfile }: UseInvoiceReturnPreviewArgs): ReturnPreviewState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const requestKey = enabled && companyUrl && sessionId && posProfile && invoiceName
    ? JSON.stringify({ companyUrl, invoiceName, posProfile, sessionId })
    : null;
  const [state, setState] = useState<{ data: PosInvoiceReturnPreview | null; error: string | null; requestKey: string | null }>({ data: null, error: null, requestKey: null });

  useEffect(() => {
    if (!requestKey || !companyUrl || !sessionId || !posProfile) return;
    const controller = new AbortController();

    void getVunaMethod<PosInvoiceReturnPreview>(companyUrl, sessionId, 'vunapos.api.sales.get_return_preview', {
      invoice_name: invoiceName,
      pos_profile: posProfile,
    }, controller.signal)
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({ data: null, error: error instanceof Error ? error.message : 'Could not prepare this return.', requestKey });
      });

    return () => controller.abort();
  }, [companyUrl, invalidateSession, invoiceName, posProfile, requestKey, sessionId]);

  if (!requestKey) return { data: null, error: null, isLoading: false };
  return { ...state, error: state.requestKey === requestKey ? state.error : null, isLoading: state.requestKey !== requestKey };
}
