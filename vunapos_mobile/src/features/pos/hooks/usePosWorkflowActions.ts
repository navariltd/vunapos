import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import {
  FrappeClientError,
  getVunaMethod,
  postVunaMethod,
} from "@/services/frappeClient";

export type PosWorkflowAction = { action: string; next_state: string };

type Args = { doctype: string; name: string; posProfile?: string };

/** Reads the server-authorized actions for one draft and applies one action. */
export function usePosWorkflowActions({ doctype, name, posProfile }: Args) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey =
    connectionStatus === "online" && companyUrl && sessionId && posProfile
      ? JSON.stringify({
          companyUrl,
          doctype,
          name,
          posProfile,
          reloadKey,
          sessionId,
        })
      : null;
  const [fetchState, setFetchState] = useState<{
    actions: PosWorkflowAction[];
    error: string | null;
    key: string | null;
  }>({ actions: [], error: null, key: null });
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState<string | null>(null);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!requestKey || !companyUrl || !sessionId || !posProfile) return;
    const controller = new AbortController();
    void getVunaMethod<PosWorkflowAction[]>(
      companyUrl,
      sessionId,
      "vunapos.api.profile.get_workflow_actions",
      { doctype, docname: name, pos_profile: posProfile },
      controller.signal,
    )
      .then((actions) =>
        setFetchState({ actions, error: null, key: requestKey }),
      )
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        ) {
          void invalidateSession();
          return;
        }
        setFetchState({
          actions: [],
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not load workflow actions.",
          key: requestKey,
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    doctype,
    invalidateSession,
    name,
    posProfile,
    requestKey,
    sessionId,
  ]);

  const actions = fetchState.key === requestKey ? fetchState.actions : [];
  const fetchError = fetchState.key === requestKey ? fetchState.error : null;

  const apply = useCallback(
    async (action: string) => {
      if (
        connectionStatus !== "online" ||
        !companyUrl ||
        !sessionId ||
        !posProfile
      )
        return false;
      setIsApplying(action);
      setApplyError(null);
      try {
        await postVunaMethod(
          companyUrl,
          sessionId,
          "vunapos.api.profile.apply_workflow_action",
          { action, doctype, docname: name, pos_profile: posProfile },
        );
        reload();
        return true;
      } catch (requestError) {
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        )
          void invalidateSession();
        setApplyError(
          requestError instanceof Error
            ? requestError.message
            : "Could not apply workflow action.",
        );
        return false;
      } finally {
        setIsApplying(null);
      }
    },
    [
      companyUrl,
      connectionStatus,
      doctype,
      invalidateSession,
      name,
      posProfile,
      reload,
      sessionId,
    ],
  );

  return {
    actions,
    apply,
    error: applyError ?? fetchError,
    isApplying,
    isLoading: Boolean(requestKey && fetchState.key !== requestKey),
    reload,
  };
}
