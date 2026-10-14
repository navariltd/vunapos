import { useEffect } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { frappeRealtimeClient } from "@/sync/frappeRealtimeClient";

/** Starts one app-owned socket for the authenticated session. Socket.IO owns reconnects. */
export function useFrappeRealtime(siteName?: string) {
  const { authState, companyUrl, sessionId } = useAppSession();

  useEffect(() => {
    if (
      authState !== "signedIn" ||
      !companyUrl ||
      !sessionId ||
      !siteName
    ) {
      frappeRealtimeClient.stop();
      return;
    }

    frappeRealtimeClient.start(companyUrl, sessionId, siteName);
    return () => frappeRealtimeClient.stop();
  }, [authState, companyUrl, sessionId, siteName]);
}
