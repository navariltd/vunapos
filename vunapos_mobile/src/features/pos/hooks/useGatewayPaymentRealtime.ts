import { useEffect } from "react";

import type { PosGatewayPaymentLink } from "@/features/pos/types";
import { frappeRealtimeClient } from "@/sync/frappeRealtimeClient";

/** Observes cashier-scoped gateway changes on the app-owned socket. */
export function useGatewayPaymentRealtime(
  onChange: (payment: PosGatewayPaymentLink) => void,
) {
  useEffect(() => frappeRealtimeClient.subscribeGatewayPayment((payload) => {
    if (payload && typeof payload === "object") {
      onChange(payload as PosGatewayPaymentLink);
    }
  }), [onChange]);
}
