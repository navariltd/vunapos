import { useCallback, useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { invalidateRealtimeResource } from "@/sync/realtimeInvalidation";
import {
  POS_CACHE_TTL_MS,
  refreshRegisteredPosResources,
} from "@/hooks/usePosCachedResource";

/**
 * Runs the SPA-style reachability repair without making the device network
 * flag authoritative. Cached rows remain usable while a probe is pending; a
 * successful probe asks the existing bootstrap owner for a timestamp delta.
 */
export function usePosRefreshTriggers() {
  const { authState, companyUrl, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const previousConnection = useRef(connectionStatus);
  const previousAppState = useRef<AppStateStatus>(AppState.currentState);
  const probeInFlight = useRef(false);

  const probeAndRefresh = useCallback(async (source: "foreground" | "reconnect") => {
    if (
      authState !== "signedIn" ||
      connectionStatus !== "online" ||
      !companyUrl ||
      !sessionId ||
      probeInFlight.current
    ) {
      return;
    }
    probeInFlight.current = true;
    try {
      await getVunaMethod(
        companyUrl,
        sessionId,
        "vunapos.api.pos.get_pos_bootstrap_config",
      );
      await invalidateRealtimeResource("workspace-configuration", {
        full: false,
        source,
      });
    } catch {
      // A failed probe is expected during a transient outage. Existing cached
      // data remains visible and the next trigger retries it.
    } finally {
      probeInFlight.current = false;
    }
  }, [authState, companyUrl, connectionStatus, sessionId]);

  useEffect(() => {
    const wasOnline = previousConnection.current === "online";
    previousConnection.current = connectionStatus;
    if (!wasOnline && connectionStatus === "online") {
      void probeAndRefresh("reconnect");
    }
  }, [connectionStatus, probeAndRefresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackgrounded = previousAppState.current !== "active";
      previousAppState.current = nextState;
      if (wasBackgrounded && nextState === "active") {
        void probeAndRefresh("foreground");
      }
    });
    return () => subscription.remove();
  }, [probeAndRefresh]);

  // One scheduler owns freshness for every mounted cached resource. Individual
  // resources register their loaders but never create their own intervals.
  useEffect(() => {
    if (authState !== "signedIn" || connectionStatus !== "online") return;
    const timer = setInterval(() => {
      void refreshRegisteredPosResources();
    }, POS_CACHE_TTL_MS);
    return () => clearInterval(timer);
  }, [authState, connectionStatus]);
}
