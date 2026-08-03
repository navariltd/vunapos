import { useEffect } from "react";

import { checkReachability } from "../lib/stores/connectivityStore";

const PING_INTERVAL_MS = 30_000;

// The single owner of the connectivity ping interval and online/offline listeners -
// mounted once (see App.tsx). Everything else reads connectivityStore via the thin
// useConnectivity() selector, which no longer registers its own side effects.
export function ConnectivityMonitor() {
  useEffect(() => {
    void checkReachability();

    const interval = window.setInterval(() => {
      void checkReachability();
    }, PING_INTERVAL_MS);

    const onOnline = () => void checkReachability();
    window.addEventListener("online", onOnline);

    // Hint to recheck sooner (ADR-010): without it, a mid-session disconnect stays
    // "reachable" for up to PING_INTERVAL_MS, during which isReachable-gated code
    // (e.g. held-invoice fetches) still hits frappe-react-sdk's uncatchable TypeError.
    const onOffline = () => void checkReachability();
    window.addEventListener("offline", onOffline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return null;
}
