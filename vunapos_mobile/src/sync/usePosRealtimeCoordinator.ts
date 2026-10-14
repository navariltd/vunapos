import { useEffect, useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import type { PosBootstrapData } from "@/features/pos/types";
import {
  clearOperationalPosCache,
  invalidateOperationalPosCache,
} from "@/services/posCacheInvalidation";
import {
  registerOperationalCacheRecovery,
  registerRealtimeControlRefresh,
} from "@/sync/realtimeInvalidation";
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
  const { authState, companyUrl, invalidateSession, sessionId } = useAppSession();
  const enabled = authState === "signedIn";
  const catalogue = usePosBootstrap({
    enabled,
    manageFreshness: true,
  });
  const [pendingProfileRevalidation, setPendingProfileRevalidation] = useState<{
    scope: string;
    count: number;
  } | null>(null);
  const activeScope = companyUrl && sessionId
    ? JSON.stringify([companyUrl, sessionId]) : null;
  const reloadCatalogue = useRef(catalogue.reload);
  const activeProfile = useRef(catalogue.data?.pos_profile?.name);

  useEffect(() => {
    reloadCatalogue.current = catalogue.reload;
  }, [catalogue.reload]);

  useEffect(() => {
    activeProfile.current = catalogue.data?.pos_profile?.name;
  }, [catalogue.data?.pos_profile?.name]);

  useEffect(() => {
    if (!enabled) return;
    const revalidationScope = JSON.stringify([companyUrl, sessionId]);
    const workspaceScope = companyUrl && sessionId
      ? { companyUrl, userId: sessionId, posProfile: "workspace" }
      : null;
    const workspaceKey = workspaceScope
      ? { scope: workspaceScope, resource: POS_WORKSPACE_RESOURCE }
      : null;
    const unregisterOperationalRecovery = registerOperationalCacheRecovery(async () => {
      if (!workspaceKey || !companyUrl || !sessionId) return;
      const snapshot = await posCache.read<PosBootstrapData>(workspaceKey);
      const posProfile = snapshot?.data.pos_profile?.name ?? activeProfile.current;
      if (!posProfile) return;
      await invalidateOperationalPosCache({ companyUrl, posProfile, sessionId });
    });
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
        setPendingProfileRevalidation((current) => ({
          scope: revalidationScope,
          count: current?.scope === revalidationScope ? current.count + 1 : 1,
        }));
        try {
          if (workspaceKey && workspaceScope) {
            const previous = await posCache.read<PosBootstrapData>(workspaceKey);
            const previousProfile = previous?.data.pos_profile?.name ?? activeProfile.current;
            if (previousProfile) {
              const clearedOperational = await clearOperationalPosCache({
                companyUrl: workspaceScope.companyUrl,
                sessionId: workspaceScope.userId,
                posProfile: previousProfile,
              });
              if (clearedOperational === false) {
                await invalidateSession();
                return;
              }
            }
            const clearedWorkspace = await posCache.clearResource(
              workspaceScope, POS_WORKSPACE_RESOURCE,
            );
            if (clearedWorkspace === false) {
              await invalidateSession();
              return;
            }
          }
          await reloadCatalogue.current({ full: true });
        } finally {
          setPendingProfileRevalidation((current) =>
            current?.scope === revalidationScope
              ? current.count > 1 ? { ...current, count: current.count - 1 } : null
              : current,
          );
        }
      },
    );
    return () => {
      unregisterReference();
      unregisterProfile();
      unregisterOperationalRecovery();
    };
  }, [companyUrl, enabled, invalidateSession, sessionId]);

  return {
    ...catalogue,
    isScopeInvalidated: Boolean(
      pendingProfileRevalidation?.scope === activeScope || catalogue.isScopeInvalidated,
    ),
  };
}
