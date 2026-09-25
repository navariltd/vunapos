import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosInvoiceDetail } from "@/features/pos/types";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type PosInvoiceDetailsState = {
  data: PosInvoiceDetail | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

type PosInvoiceDetailsRequestState = Omit<
  PosInvoiceDetailsState,
  "isLoading" | "reload"
> & {
  requestKey: string | null;
};

type UsePosInvoiceDetailsArgs = {
  invoiceDoctype?: string;
  invoiceName: string;
  posProfile: string | undefined;
  refreshKey?: number;
};

export function usePosInvoiceDetails({
  invoiceDoctype,
  invoiceName,
  posProfile,
  refreshKey = 0,
}: UsePosInvoiceDetailsArgs): PosInvoiceDetailsState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const requestKey =
    companyUrl && sessionId && posProfile && invoiceName
      ? JSON.stringify({
          companyUrl,
          invoiceDoctype,
          invoiceName,
          posProfile,
          refreshKey,
          reloadKey,
          sessionId,
        })
      : null;
  const [state, setState] = useState<PosInvoiceDetailsRequestState>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (
      connectionStatus === "offline" ||
      !companyUrl ||
      !sessionId ||
      !posProfile ||
      !invoiceName
    ) {
      return;
    }

    const controller = new AbortController();

    void getVunaMethod<PosInvoiceDetail>(
      companyUrl,
      sessionId,
      "vunapos.api.sales.get_invoice_details",
      {
        invoice_doctype: invoiceDoctype,
        invoice_name: invoiceName,
        pos_profile: posProfile,
      },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === "session") {
          void invalidateSession();
          return;
        }
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Could not load invoice details.",
          requestKey,
        }));
      });

    return () => controller.abort();
  }, [
    companyUrl,
    connectionStatus,
    invalidateSession,
    invoiceDoctype,
    invoiceName,
    posProfile,
    refreshKey,
    requestKey,
    sessionId,
  ]);

  if (!requestKey) return { data: null, error: null, isLoading: false, reload };

  if (connectionStatus === "offline") {
    return { data: state.data, error: null, isLoading: false, reload };
  }

  return {
    ...state,
    error: state.requestKey === requestKey ? state.error : null,
    isLoading: state.requestKey !== requestKey,
    reload,
  };
}
