import { useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosPaymentReconciliationCandidates } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type ReconciliationCandidatesState = {
  data: PosPaymentReconciliationCandidates | null;
  error: string | null;
  isLoading: boolean;
};

type RequestState = Omit<ReconciliationCandidatesState, "isLoading"> & {
  requestKey: string | null;
};

/** Loads the server-authoritative entries eligible for one customer's reconciliation. */
export function usePosPaymentReconciliationCandidates(
  customer: string,
  posProfile?: string,
): ReconciliationCandidatesState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const activeKey =
    companyUrl && sessionId && customer && posProfile
      ? `${companyUrl}:${sessionId}:${posProfile}:${customer}`
      : null;
  const requestKey = connectionStatus === "offline" ? null : activeKey;
  const [state, setState] = useState<RequestState>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile || !customer || !requestKey)
      return;
    const controller = new AbortController();

    void getVunaMethod<PosPaymentReconciliationCandidates>(
      companyUrl,
      sessionId,
      "vunapos.api.payment.get_reconciliation_candidates",
      { customer, pos_profile: posProfile },
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
              : "Could not load reconciliation candidates.",
          requestKey,
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    customer,
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
