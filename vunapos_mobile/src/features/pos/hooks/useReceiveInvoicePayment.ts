import { useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { PosReceivedPayment } from "@/features/pos/types";
import { FrappeClientError, postVunaMethod } from "@/services/frappeClient";

export type ReceiveCustomerPaymentInput = {
  amount: number;
  customer: string;
  invoice?: string;
  modeOfPayment: string;
  posProfile: string;
  referenceDate?: string;
  referenceNo?: string;
  remarks?: string;
};

function createIdempotencyKey() {
  return `mobile-payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Submits a customer advance or invoice allocation with a retry-safe key. */
export function useReceiveCustomerPayment() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  async function receive(
    input: ReceiveCustomerPaymentInput,
  ): Promise<PosReceivedPayment | null> {
    if (connectionStatus === "offline") {
      setError("Connection unavailable. Reconnect before receiving a payment.");
      return null;
    }
    if (!companyUrl || !sessionId) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return null;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const payment = await postVunaMethod<PosReceivedPayment>(
        companyUrl,
        sessionId,
        "vunapos.api.payment.receive_customer_payment",
        {
          amount: input.amount,
          customer: input.customer,
          idempotency_key: idempotencyKey.current,
          mode_of_payment: input.modeOfPayment,
          pos_profile: input.posProfile,
          reference_date: input.referenceDate,
          reference_no: input.referenceNo,
          ...(input.remarks ? { remarks: input.remarks } : {}),
          ...(input.invoice
            ? {
                allocated_amount: input.amount,
                sales_invoice: input.invoice,
              }
            : {}),
        },
      );
      idempotencyKey.current = createIdempotencyKey();
      return payment;
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
          : "Could not receive the payment.",
      );
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { error, isSubmitting, receive };
}

/** Compatibility hook for invoice-detail payment collection. */
export function useReceiveInvoicePayment() {
  return useReceiveCustomerPayment();
}
