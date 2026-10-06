import { useEffect, useRef } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { registerRealtimeControlRefresh } from "@/sync/realtimeInvalidation";
import {
  POS_PROFILE_CHANGED_RESOURCE,
  POS_REFERENCE_DATA_RESOURCE,
  POS_WORKSPACE_RESOURCE,
} from "@/sync/posResourceKeys";
import { posCache } from "@/services/posCache";

type ConfigurationSignal = {
  full?: boolean;
  refresh?: string;
};

function isFullRefreshSignal(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const signal = payload as ConfigurationSignal;
  return signal.full === true || signal.refresh === "full";
}

/**
 * Owns POS configuration synchronization for the authenticated application.
 *
 * Feature screens consume the cache, but they do not subscribe to the socket.
 * Keeping the refresh owner here means a Desk change is handled even when the
 * cashier is viewing a detail screen, and it prevents one event from being
 * routed through several mounted bootstrap hooks.
 */
export function usePosRealtimeCoordinator() {
  const { authState, companyUrl, sessionId } = useAppSession();
  const enabled = authState === "signedIn";
  const catalogue = usePosBootstrap({
    enabled,
    manageFreshness: true,
    subscribeRealtime: false,
  });
  const reloadCatalogue = useRef(catalogue.reload);

  useEffect(() => {
    reloadCatalogue.current = catalogue.reload;
  }, [catalogue.reload]);

  useEffect(() => {
    if (!enabled) return;
    const unregisterReference = registerRealtimeControlRefresh(
      POS_REFERENCE_DATA_RESOURCE,
      (payload) => {
        const full = isFullRefreshSignal(payload);
        return Promise.resolve(reloadCatalogue.current({ full })).then(() => undefined);
      },
    );
    const unregisterProfile = registerRealtimeControlRefresh(
      POS_PROFILE_CHANGED_RESOURCE,
      async () => {
        if (companyUrl && sessionId) {
          await posCache.clearResource(
            { companyUrl, userId: sessionId, posProfile: "workspace" },
            POS_WORKSPACE_RESOURCE,
          );
        }
        await reloadCatalogue.current({ full: true });
      },
    );
    return () => {
      unregisterReference();
      unregisterProfile();
    };
  }, [companyUrl, enabled, sessionId]);
}
