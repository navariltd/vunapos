import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { PosHeldInvoice } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type UsePosHeldInvoicesArgs = {
  enabled: boolean;
  posProfile?: string;
  refreshKey?: number;
};

/** Lists the active POS profile's server-held drafts; no local queue is used. */
export function usePosHeldInvoices({
  enabled,
  posProfile,
  refreshKey = 0,
}: UsePosHeldInvoicesArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [data, setData] = useState<PosHeldInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (connectionStatus === "offline") {
      setError("Connection unavailable. Reconnect before loading held invoices.");
      return;
    }
    if (!companyUrl || !sessionId || !posProfile) return;
    setError(null);
    setIsLoading(true);
    try {
      const heldInvoices = await getVunaMethod<PosHeldInvoice[]>(
        companyUrl,
        sessionId,
        "vunapos.api.sales.list_held_invoices",
        { limit: 20, pos_profile: posProfile },
      );
      setData(heldInvoices);
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load held invoices.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [companyUrl, connectionStatus, invalidateSession, posProfile, sessionId]);

  useEffect(() => {
    if (!enabled) return;
    const timeout = setTimeout(() => void load(), 0);
    return () => clearTimeout(timeout);
  }, [enabled, load, refreshKey]);

  return { data, error, isLoading, reload: load };
}
