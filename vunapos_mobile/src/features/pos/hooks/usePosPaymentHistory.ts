import { useCallback, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosPaymentHistory } from "@/features/pos/types";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type PaymentHistoryState = {
  data: PosPaymentHistory | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  lastUpdated: number | null;
  reload: () => void | Promise<void>;
};

export type PosPaymentHistoryFilters = {
  cashier?: string;
  customer?: string;
  fromDate?: string;
  modeOfPayment?: string;
  reference?: string;
  status?: "Cancelled" | "Submitted" | "";
  toDate?: string;
};

/** Cached, readonly payment history. Receiving and reconciliation stay live-only. */
export function usePosPaymentHistory(
  posProfile?: string,
  filters: PosPaymentHistoryFilters = {},
  enabled = true,
): PaymentHistoryState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const query = {
    cashier: filters.cashier || "",
    customer: filters.customer || "",
    fromDate: filters.fromDate || "",
    modeOfPayment: filters.modeOfPayment || "",
    reference: filters.reference || "",
    status: filters.status || "",
    toDate: filters.toDate || "",
  };
  const cacheKey =
    companyUrl && sessionId && posProfile
      ? {
          query,
          resource: "payment-history",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!companyUrl || !sessionId || !posProfile) {
        throw new Error("Your POS workspace is still loading.");
      }
      try {
        return await getVunaMethod<PosPaymentHistory>(
          companyUrl,
          sessionId,
          "vunapos.api.payment.get_payment_history",
          {
            ...(filters.customer ? { customer: filters.customer } : {}),
            ...(filters.fromDate ? { from_date: filters.fromDate } : {}),
            ...(filters.modeOfPayment
              ? { mode_of_payment: filters.modeOfPayment }
              : {}),
            ...(filters.reference ? { reference: filters.reference } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.toDate ? { to_date: filters.toDate } : {}),
            ...(filters.cashier ? { cashier: filters.cashier } : {}),
            pos_profile: posProfile,
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
    },
    [companyUrl, filters, invalidateSession, posProfile, sessionId],
  );
  const resource = usePosCachedResource({
    cacheKey,
    connectionStatus,
    enabled,
    load,
  });

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
