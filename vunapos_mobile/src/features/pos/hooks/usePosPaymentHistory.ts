import { useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosPaymentHistory } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type PaymentHistoryState = {
  data: PosPaymentHistory | null;
  error: string | null;
  isLoading: boolean;
};

export type PosPaymentHistoryFilters = {
  customer?: string;
  fromDate?: string;
  toDate?: string;
};

type RequestState = Omit<PaymentHistoryState, "isLoading"> & {
  requestKey: string | null;
};

/** Loads submitted and cancelled VunaPOS Payment Entries for one POS Profile. */
export function usePosPaymentHistory(
  posProfile?: string,
  filters: PosPaymentHistoryFilters = {},
  enabled = true,
): PaymentHistoryState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const activeKey =
    enabled && companyUrl && sessionId && posProfile
      ? JSON.stringify({ companyUrl, filters, posProfile, sessionId })
      : null;
  const requestKey = connectionStatus === "offline" ? null : activeKey;
  const [state, setState] = useState<RequestState>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile || !requestKey) return;
    const controller = new AbortController();

    void getVunaMethod<PosPaymentHistory>(
      companyUrl,
      sessionId,
      "vunapos.api.payment.get_payment_history",
      {
        ...(filters.customer ? { customer: filters.customer } : {}),
        ...(filters.fromDate ? { from_date: filters.fromDate } : {}),
        ...(filters.toDate ? { to_date: filters.toDate } : {}),
        pos_profile: posProfile,
      },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        ) {
          void invalidateSession();
          return;
        }
        setState({
          data: null,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not load payment history.",
          requestKey,
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    filters.customer,
    filters.fromDate,
    filters.toDate,
    invalidateSession,
    posProfile,
    requestKey,
    sessionId,
  ]);

  if (!activeKey) return { data: null, error: null, isLoading: false };
  return {
    data: state.requestKey === activeKey ? state.data : null,
    error: state.requestKey === activeKey ? state.error : null,
    isLoading: Boolean(requestKey) && state.requestKey !== activeKey,
  };
}
