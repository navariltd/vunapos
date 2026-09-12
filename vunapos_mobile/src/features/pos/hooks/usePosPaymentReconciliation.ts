import { useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosPaymentReconciliationAllocation } from "@/features/pos/types";
import { FrappeClientError, postVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type ReconcileInput = {
  customer: string;
  invoices: string[];
  paymentEntries: string[];
  posProfile: string;
};

export type PosPaymentReconciliationResult = {
  allocated_amount: number;
  allocations: PosPaymentReconciliationAllocation[];
};

/** Commits a reviewed reconciliation while the server revalidates every entry. */
export function usePosPaymentReconciliation() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [error, setError] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  function clearError() {
    setError(null);
  }

  async function reconcile(
    input: ReconcileInput,
  ): Promise<PosPaymentReconciliationResult | null> {
    if (connectionStatus === "offline") {
      setError(
        "Connection unavailable. Reconnect before reconciling payments.",
      );
      return null;
    }
    if (!companyUrl || !sessionId) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return null;
    }

    setError(null);
    setIsReconciling(true);
    try {
      return await postVunaMethod<PosPaymentReconciliationResult>(
        companyUrl,
        sessionId,
        "vunapos.api.payment.reconcile_customer_payment",
        {
          customer: input.customer,
          invoices: JSON.stringify(input.invoices),
          payment_entries: JSON.stringify(input.paymentEntries),
          pos_profile: input.posProfile,
        },
      );
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reconcile the selected payments.",
      );
      return null;
    } finally {
      setIsReconciling(false);
    }
  }

  return { clearError, error, isReconciling, reconcile };
}
