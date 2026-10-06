import { useEffect } from "react";
import { io } from "socket.io-client";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
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
  const bootstrap = usePosBootstrap({
    enabled: Boolean(companyUrl && sessionId),
  });
  const siteName = bootstrap.data?.site_name;

  useEffect(() => {
    if (!companyUrl || !sessionId || !siteName) return;
    const connection = getFrappeRealtimeConnection(companyUrl, siteName);
    const socket = io(connection.url, {
      extraHeaders: {
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
        ...(connection.hostHeader ? { Host: connection.hostHeader } : {}),
        Origin: connection.originHeader ?? companyUrl,
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
  }, [companyUrl, onChange, sessionId, siteName]);
}
