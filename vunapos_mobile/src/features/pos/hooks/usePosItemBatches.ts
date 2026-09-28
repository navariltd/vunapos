import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosItemBatches } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type Args = {
  enabled: boolean;
  itemCode: string;
  posProfile?: string;
};

type State = {
  data: PosItemBatches | null;
  error: string | null;
  requestKey: string | null;
};

/** Loads live, profile-scoped batch availability only when a tracked cart row is opened. */
export function usePosItemBatches({ enabled, itemCode, posProfile }: Args) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey =
    enabled && companyUrl && sessionId && posProfile && itemCode
      ? `${companyUrl}:${sessionId}:${posProfile}:${itemCode}:${reloadKey}`
      : null;
  const [state, setState] = useState<State>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (!requestKey || !companyUrl || !sessionId || !posProfile) return;
    const controller = new AbortController();
    void getVunaMethod<PosItemBatches>(
      companyUrl,
      sessionId,
      "vunapos.api.batch.get_item_batches",
      {
        item_code: itemCode,
        pos_profile: posProfile,
      },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === "session") {
          void invalidateSession();
          return;
        }
        setState({
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not load batch availability.",
          requestKey,
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    invalidateSession,
    itemCode,
    posProfile,
    requestKey,
    sessionId,
  ]);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);
  return {
    data: state.requestKey === requestKey ? state.data : null,
    error: state.requestKey === requestKey ? state.error : null,
    isLoading: Boolean(requestKey) && state.requestKey !== requestKey,
    reload,
  };
}
