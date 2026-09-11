import { useEffect } from 'react';
import { io } from 'socket.io-client';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosGatewayPaymentLink } from '@/features/pos/types';

export const GATEWAY_PAYMENT_EVENT = 'vunapos_gateway_payment_changed';

export function getGatewayRealtimeConnection(companyUrl: string) {
  const url = new URL(companyUrl);
  const siteName = process.env.EXPO_PUBLIC_FRAPPE_SITE_NAME?.trim() || url.hostname;

  // `bench start` exposes Socket.IO directly on 9000; production proxies it
  // through the same origin as Frappe.
  if (url.port === '8000') url.port = '9000';

  return { siteName, url: `${url.origin}/${siteName}` };
}

/** Listens only for gateway-link changes delivered to the signed-in cashier. */
export function useGatewayPaymentRealtime(onChange: (payment: PosGatewayPaymentLink) => void) {
  const { companyUrl, sessionId } = useAppSession();

  useEffect(() => {
    if (!companyUrl || !sessionId) return;
    const connection = getGatewayRealtimeConnection(companyUrl);
    const socket = io(connection.url, {
      extraHeaders: {
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
        Origin: companyUrl,
        'X-Frappe-Site-Name': connection.siteName,
      },
      reconnectionAttempts: 3,
      transports: ['websocket'],
    });
    socket.on(GATEWAY_PAYMENT_EVENT, onChange);

    return () => {
      socket.off(GATEWAY_PAYMENT_EVENT, onChange);
      socket.disconnect();
    };
  }, [companyUrl, onChange, sessionId]);
}
