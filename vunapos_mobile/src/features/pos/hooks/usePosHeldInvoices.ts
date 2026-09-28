import { useCallback, useEffect } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { PosHeldInvoice } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type UsePosHeldInvoicesArgs = {
  enabled: boolean;
  posProfile?: string;
  refreshKey?: number;
};

/** Cached draft list for browsing; a restore is still verified live by the server. */
export function usePosHeldInvoices({
  enabled,
  posProfile,
  refreshKey = 0,
}: UsePosHeldInvoicesArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const cacheKey =
    companyUrl && sessionId && posProfile
      ? {
          query: { limit: 20 },
          resource: "held-invoices",
          scope: { companyUrl, posProfile, userId: sessionId },
        }
      : null;
  const load = useCallback(async (signal: AbortSignal) => {
    if (!companyUrl || !sessionId || !posProfile) {
      throw new Error("Your POS workspace is still loading.");
    }
    try {
      return await getVunaMethod<PosHeldInvoice[]>(
        companyUrl,
        sessionId,
        "vunapos.api.sales.list_held_invoices",
        { limit: 20, pos_profile: posProfile },
        signal,
      );
    } catch (error) {
      if (error instanceof FrappeClientError && error.code === "session") {
        void invalidateSession();
      }
      throw error;
    }
  }, [companyUrl, invalidateSession, posProfile, sessionId]);
  const resource = usePosCachedResource({
    cacheKey,
    connectionStatus,
    enabled,
    load,
  });
  const reload = resource.refresh;

  useEffect(() => {
    if (enabled && refreshKey > 0) void reload();
  }, [enabled, refreshKey, reload]);

  return {
    data: resource.data,
    error: resource.error,
    isLoading: resource.isLoading,
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    lastUpdated: resource.lastUpdated,
    reload,
  };
}
