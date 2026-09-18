import { useEffect } from "react";
import { io } from "socket.io-client";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { getFrappeRealtimeConnection } from "@/sync/frappeRealtimeClient";
import { PosGatewayPaymentLink } from "@/features/pos/types";

export const GATEWAY_PAYMENT_EVENT = "vunapos_gateway_payment_changed";

// Kept as a compatibility alias for existing gateway-payment callers and tests.
export const getGatewayRealtimeConnection = getFrappeRealtimeConnection;

/** Listens only for gateway-link changes delivered to the signed-in cashier. */
export function useGatewayPaymentRealtime(
  onChange: (payment: PosGatewayPaymentLink) => void,
) {
  const { companyUrl, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();

  useEffect(() => {
    if (connectionStatus !== "online" || !companyUrl || !sessionId) return;
    const connection = getFrappeRealtimeConnection(companyUrl);
    const socket = io(connection.url, {
      extraHeaders: {
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
        Origin: companyUrl,
        "X-Frappe-Site-Name": connection.siteName,
      },
      reconnectionAttempts: 3,
      transports: ["websocket", "polling"],
    });
    socket.on(GATEWAY_PAYMENT_EVENT, onChange);

    return () => {
      socket.off(GATEWAY_PAYMENT_EVENT, onChange);
      socket.disconnect();
    };
  }, [companyUrl, connectionStatus, onChange, sessionId]);
}
