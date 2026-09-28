import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosClosingPreview } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type PosClosingPreviewState = {
  data: PosClosingPreview | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

type PosClosingPreviewRequestState = Omit<
  PosClosingPreviewState,
  "isLoading" | "reload"
> & {
  requestKey: string | null;
};

/**
 * Loads the current POS Closing Entry preview. Unlike browsing data, a shift
 * close must never rely on an offline or stale result.
 */
export function usePosClosingPreview(
  posProfile: string | undefined,
): PosClosingPreviewState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [reloadKey, setReloadKey] = useState(0);
  const activeKey =
    companyUrl && sessionId && posProfile
      ? JSON.stringify({ companyUrl, posProfile, reloadKey, sessionId })
      : null;
  const requestKey = activeKey;
  const [state, setState] = useState<PosClosingPreviewRequestState>({
    data: null,
    error: null,
    requestKey: null,
  });
  const reload = useCallback(() => {
    if (posProfile) {
      setReloadKey((current) => current + 1);
    }
  }, [posProfile]);

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile || !requestKey) return;

    const controller = new AbortController();
    void getVunaMethod<PosClosingPreview>(
      companyUrl,
      sessionId,
      "vunapos.api.pos_closing.get_preview",
      { pos_profile: posProfile },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === "session") {
          void invalidateSession();
          return;
        }
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Could not load the closing summary.",
          requestKey,
        }));
      });

    return () => controller.abort();
  }, [companyUrl, invalidateSession, posProfile, requestKey, sessionId]);

  if (!activeKey) {
    return { data: null, error: null, isLoading: false, reload };
  }

  return {
    ...state,
    data: state.requestKey === activeKey ? state.data : null,
    error: state.requestKey === activeKey ? state.error : null,
    isLoading: state.requestKey !== activeKey,
    reload,
  };
}
