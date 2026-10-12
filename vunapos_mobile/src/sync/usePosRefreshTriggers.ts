import { useCallback, useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  validateFrappeSession,
} from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { recoverPosResources } from "@/sync/realtimeInvalidation";
import {
  POS_CACHE_TTL_MS,
  refreshRegisteredPosResources,
} from "@/hooks/usePosCachedResource";
import {
  getServerReachabilityDiagnostics,
  recordServerReachability,
  resetServerReachability,
} from "@/sync/serverReachability";

const SERVER_REACHABILITY_INTERVAL_MS = 30_000;

/**
 * Runs the SPA-style reachability repair without making the device network
 * flag authoritative. Cached rows remain usable while a probe is pending; a
 * successful probe asks the existing bootstrap owner for a timestamp delta.
 */
export function usePosRefreshTriggers() {
  const { authState, companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const scope = `${authState}:${companyUrl ?? ""}:${sessionId ?? ""}`;
  const currentScope = useRef(scope);
  const previousConnection = useRef(connectionStatus);
  const previousAppState = useRef<AppStateStatus>(AppState.currentState);
  const probeInFlight = useRef<string | null>(null);
  const reachabilityProbeInFlight = useRef<{
    scope: string;
    promise: Promise<{ reachable: boolean; repaired: boolean }>;
  } | undefined>(
    undefined,
  );
  const expiredSessionHandled = useRef<string | null>(null);

  useEffect(() => {
    currentScope.current = scope;
  }, [scope]);

  const probeServerReachability = useCallback(async () => {
    if (
      authState !== "signedIn" ||
      connectionStatus !== "online" ||
      !companyUrl ||
      !sessionId
    ) {
      return { reachable: false, repaired: false };
    }
    if (reachabilityProbeInFlight.current?.scope === scope) {
      return reachabilityProbeInFlight.current.promise;
    }

    const probe = (async () => {
      const status = await validateFrappeSession(companyUrl, sessionId);
      if (currentScope.current !== scope) return { reachable: false, repaired: false };
      if (status === "valid") {
        const wasUnreachable = getServerReachabilityDiagnostics().status === "unreachable";
        recordServerReachability({ status: "reachable" });
        if (wasUnreachable) {
          // A device can remain online while Frappe is down. Repair once on
          // the server transition, using the existing root refresh owner.
          try {
            await recoverPosResources("reconnect");
          } catch {
            // Keep the last-known-good data; the next scheduler tick retries.
          }
        }
        return { reachable: true, repaired: wasUnreachable };
      }
      if (status === "expired") {
        recordServerReachability({
          status: "session-expired",
          error: "Your session has expired. Sign in again to continue.",
        });
        if (expiredSessionHandled.current !== sessionId) {
          expiredSessionHandled.current = sessionId;
          await invalidateSession();
        }
      } else {
        recordServerReachability({
          status: "unreachable",
          error: "The company server could not be reached.",
        });
      }
      return { reachable: false, repaired: false };
    })();
    reachabilityProbeInFlight.current = { scope, promise: probe };
    try {
      return await probe;
    } finally {
      if (reachabilityProbeInFlight.current?.promise === probe) {
        reachabilityProbeInFlight.current = undefined;
      }
    }
  }, [authState, companyUrl, connectionStatus, invalidateSession, scope, sessionId]);

  const probeAndRefresh = useCallback(async (source: "foreground" | "reconnect") => {
    if (
      authState !== "signedIn" ||
      connectionStatus !== "online" ||
      !companyUrl ||
      !sessionId ||
      probeInFlight.current === scope
    ) {
      return;
    }
    probeInFlight.current = scope;
    try {
      const result = await probeServerReachability();
      if (!result.reachable || result.repaired) return;
      // Reachability is already established by validateFrappeSession above.
      // Let the cache owner perform the one configuration request so a
      // foreground/reconnect repair cannot fetch and discard an identical
      // payload before invalidating the resource.
      await recoverPosResources(source);
    } catch {
      // A failed probe is expected during a transient outage. Existing cached
      // data remains visible and the next trigger retries it.
    } finally {
      if (probeInFlight.current === scope) probeInFlight.current = null;
    }
  }, [
    authState,
    companyUrl,
    connectionStatus,
    probeServerReachability,
    scope,
    sessionId,
  ]);

  useEffect(() => {
    if (authState !== "signedIn") {
      resetServerReachability();
      expiredSessionHandled.current = null;
      return;
    }
    void probeServerReachability();
    const timer = setInterval(() => {
      void probeServerReachability();
    }, SERVER_REACHABILITY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [authState, probeServerReachability]);

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
