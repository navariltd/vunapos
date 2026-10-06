import { useEffect, useRef } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  usePosBootstrap,
  usePosBootstrapConfig,
} from "@/features/pos/hooks/usePosBootstrap";
import { registerRealtimeRefresh } from "@/sync/realtimeInvalidation";

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
  const { authState } = useAppSession();
  const enabled = authState === "signedIn";
  const configuration = usePosBootstrapConfig({
    enabled,
    manageFreshness: true,
    subscribeRealtime: false,
  });
  const catalogue = usePosBootstrap({
    enabled,
    manageFreshness: true,
    subscribeRealtime: false,
  });
  const reloadConfiguration = useRef(configuration.reload);
  const reloadCatalogue = useRef(catalogue.reload);

  useEffect(() => {
    reloadConfiguration.current = configuration.reload;
  }, [configuration.reload]);

  useEffect(() => {
    reloadCatalogue.current = catalogue.reload;
  }, [catalogue.reload]);

  useEffect(() => {
    if (!enabled) return;
    return registerRealtimeRefresh("workspace-configuration", (payload) => {
      const full = isFullRefreshSignal(payload);
      return Promise.all([
        reloadConfiguration.current(),
        reloadCatalogue.current({ full }),
      ]).then(() => undefined);
    });
  }, [enabled]);
}
