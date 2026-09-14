import { useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosPaymentReconciliationAllocation } from "@/features/pos/types";
import { FrappeClientError, postVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type AllocationInput = {
  customer: string;
  invoices: string[];
  paymentEntries: string[];
  posProfile: string;
};

/** Requests a server-only allocation preview; it does not reconcile anything. */
export function usePosPaymentReconciliationAllocation() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [error, setError] = useState<string | null>(null);
  const [isAllocating, setIsAllocating] = useState(false);

  function clearError() {
    setError(null);
  }

  async function allocate(
    input: AllocationInput,
  ): Promise<PosPaymentReconciliationAllocation[] | null> {
    if (connectionStatus !== "online") {
      setError("Connection unavailable. Reconnect before allocating payments.");
      return null;
    }
    if (!companyUrl || !sessionId) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return null;
    }

    setError(null);
    setIsAllocating(true);
    try {
      const response = await postVunaMethod<{
        allocations: PosPaymentReconciliationAllocation[];
      }>(
        companyUrl,
        sessionId,
        "vunapos.api.payment.allocate_customer_payments",
        {
          customer: input.customer,
          invoices: JSON.stringify(input.invoices),
          payment_entries: JSON.stringify(input.paymentEntries),
          pos_profile: input.posProfile,
        },
      );
      return response.allocations;
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
          : "Could not allocate the selected payments.",
      );
      return null;
    } finally {
      setIsAllocating(false);
    }
  }

  return { allocate, clearError, error, isAllocating };
}
