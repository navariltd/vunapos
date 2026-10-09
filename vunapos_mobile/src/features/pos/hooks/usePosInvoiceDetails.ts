import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosInvoiceDetail } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type PosInvoiceDetailsState = {
  data: PosInvoiceDetail | null;
  error: string | null;
  isRecoverableError?: boolean;
  isLoading: boolean;
  reload: () => void;
};

type PosInvoiceDetailsRequestState = Omit<
  PosInvoiceDetailsState,
  "isLoading" | "reload"
> & {
  identityKey: string | null;
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
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const identityKey =
    companyUrl && sessionId && posProfile && invoiceName
      ? JSON.stringify({
          companyUrl,
          invoiceDoctype,
          invoiceName,
          posProfile,
          sessionId,
        })
      : null;
  const requestKey = identityKey
    ? JSON.stringify([identityKey, refreshKey, reloadKey]) : null;
  const [state, setState] = useState<PosInvoiceDetailsRequestState>({
    data: null,
    error: null,
    identityKey: null,
    isRecoverableError: false,
    requestKey: null,
  });

  useEffect(() => {
    if (
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
      .then((data) => setState({
        data, error: null, identityKey, isRecoverableError: false, requestKey,
      }))
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
          isRecoverableError: error instanceof FrappeClientError && error.code === "connection",
          requestKey,
        }));
      });

    return () => controller.abort();
  }, [
    companyUrl,
    identityKey,
    invalidateSession,
    invoiceDoctype,
    invoiceName,
    posProfile,
    refreshKey,
    requestKey,
    sessionId,
  ]);

  if (!requestKey) return {
    data: null, error: null, isLoading: false, isRecoverableError: false, reload,
  };

  return {
    ...state,
    data: state.identityKey === identityKey ? state.data : null,
    error: state.requestKey === requestKey ? state.error : null,
    isRecoverableError: state.requestKey === requestKey && state.isRecoverableError,
    isLoading: state.requestKey !== requestKey,
    reload,
  };
}
