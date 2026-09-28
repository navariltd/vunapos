import { useCallback, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { PosInvoiceHistory, PosInvoiceHistoryFilters } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

const pageLength = 25;

type UsePosInvoiceHistoryArgs = {
  filters: PosInvoiceHistoryFilters;
  posProfile: string | undefined;
  start: number;
};

type PosInvoiceHistoryState = {
  data: PosInvoiceHistory | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing?: boolean;
  isStale?: boolean;
  lastUpdated?: number | null;
  reload: () => void | Promise<void>;
};

/** Cached, readonly history. Detail and financial actions remain live-only. */
export function usePosInvoiceHistory({
  filters,
  posProfile,
  start,
}: UsePosInvoiceHistoryArgs): PosInvoiceHistoryState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const query = {
    currentShift: Boolean(filters.currentShift),
    customer: filters.customer.trim(),
    documentType: filters.documentType,
    fromDate: filters.fromDate,
    invoice: filters.invoice.trim(),
    paymentMode: filters.paymentMode,
    saleType: filters.saleType,
    start,
    status: filters.status,
    toDate: filters.toDate,
  };
  const cacheKey =
    companyUrl && sessionId && posProfile
      ? {
          query,
          resource: "invoice-history",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(async (signal: AbortSignal) => {
    if (!companyUrl || !sessionId || !posProfile) {
      throw new Error("Your POS workspace is still loading.");
    }
    try {
      return await getVunaMethod<PosInvoiceHistory>(
        companyUrl,
        sessionId,
        "vunapos.api.sales.get_invoice_history",
        {
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
        },
        signal,
      );
    } catch (error) {
      if (error instanceof FrappeClientError && error.code === "session") {
        setSessionInvalid(true);
        void invalidateSession();
      }
      throw error;
    }
  }, [companyUrl, filters, invalidateSession, posProfile, sessionId, start]);
  const resource = usePosCachedResource({ cacheKey, connectionStatus, load });

  if (!cacheKey) return { data: null, error: null, isLoading: false, reload: resource.refresh };
  return {
    data: resource.data,
    error: sessionInvalid ? null : resource.error,
    isLoading: resource.isLoading,
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    lastUpdated: resource.lastUpdated,
    reload: resource.refresh,
  };
}
