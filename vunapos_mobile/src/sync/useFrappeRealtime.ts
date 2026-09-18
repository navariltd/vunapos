import { useEffect } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { frappeRealtimeClient } from "@/sync/frappeRealtimeClient";

/** Starts one realtime client only while an authenticated app session is online. */
export function useFrappeRealtime() {
  const { authState, companyUrl, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();

  useEffect(() => {
    if (
      authState !== "signedIn" ||
      connectionStatus !== "online" ||
      !companyUrl ||
      !sessionId
    ) {
      frappeRealtimeClient.stop();
      return;
    }

    frappeRealtimeClient.start(companyUrl, sessionId);
    return () => frappeRealtimeClient.stop();
  }, [authState, companyUrl, connectionStatus, sessionId]);
}
