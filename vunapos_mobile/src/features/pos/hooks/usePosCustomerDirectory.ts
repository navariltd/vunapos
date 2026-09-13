import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosCustomerDirectory } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

const CUSTOMER_DIRECTORY_PAGE_SIZE = 25;

type PosCustomerDirectoryState = {
  data: PosCustomerDirectory | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

type PosCustomerDirectoryRequestState = Omit<
  PosCustomerDirectoryState,
  "isLoading" | "reload"
> & {
  requestKey: string | null;
};

/** Loads the first live, permission-filtered page of the POS customer directory. */
export function usePosCustomerDirectory(
  posProfile: string | undefined,
  query = "",
): PosCustomerDirectoryState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);
  const activeKey =
    companyUrl && sessionId && posProfile
      ? JSON.stringify({
          companyUrl,
          posProfile,
          query: debouncedQuery,
          reloadKey,
          sessionId,
        })
      : null;
  const requestKey = connectionStatus === "offline" ? null : activeKey;
  const [state, setState] = useState<PosCustomerDirectoryRequestState>({
    data: null,
    error: null,
    requestKey: null,
  });
  const reload = useCallback(() => {
    if (connectionStatus !== "offline" && posProfile) {
      setReloadKey((current) => current + 1);
    }
  }, [connectionStatus, posProfile]);

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile || !requestKey) return;

    const controller = new AbortController();
    void getVunaMethod<PosCustomerDirectory>(
      companyUrl,
      sessionId,
      "vunapos.api.customer.get_customer_directory",
      {
        limit: CUSTOMER_DIRECTORY_PAGE_SIZE,
        pos_profile: posProfile,
        query: debouncedQuery,
        start: 0,
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
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Could not load customers.",
          requestKey,
        }));
      });

    return () => controller.abort();
  }, [
    companyUrl,
    debouncedQuery,
    invalidateSession,
    posProfile,
    requestKey,
    sessionId,
  ]);

  if (!activeKey) return { data: null, error: null, isLoading: false, reload };

  return {
    ...state,
    data: state.requestKey === activeKey ? state.data : null,
    error: state.requestKey === activeKey ? state.error : null,
    isLoading: Boolean(requestKey) && state.requestKey !== activeKey,
    reload,
  };
}
