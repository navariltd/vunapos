import { useEffect } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { frappeRealtimeClient } from "@/sync/frappeRealtimeClient";

/** Starts one app-owned socket for the authenticated session. Socket.IO owns reconnects. */
export function useFrappeRealtime() {
  const { authState, companyUrl, sessionId } = useAppSession();
  const bootstrap = usePosBootstrap({ enabled: authState === "signedIn" });
  const siteName = bootstrap.data?.site_name;

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
