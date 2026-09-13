import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { PosCustomerDetails } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type PosCustomerDetailsState = {
  data: PosCustomerDetails | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

type PosCustomerDetailsRequestState = Omit<
  PosCustomerDetailsState,
  "isLoading" | "reload"
> & {
  requestKey: string | null;
};

type UsePosCustomerDetailsArgs = {
  customer: string;
  posProfile: string | undefined;
};

function isPosCustomerDetails(value: unknown): value is PosCustomerDetails {
  if (!value || typeof value !== "object") return false;

  const details = value as Record<string, unknown>;
  const customer = details.customer;
  if (!customer || typeof customer !== "object") return false;

  const customerSummary = customer as Record<string, unknown>;
  return (
    typeof details.as_of === "string" &&
    typeof details.balance === "number" &&
    typeof customerSummary.customer === "string" &&
    typeof customerSummary.customer_name === "string" &&
    (details.loyalty === null || typeof details.loyalty === "object")
  );
}

/** Fetches only the permission-filtered customer profile exposed by VunaPOS. */
export function usePosCustomerDetails({
  customer,
  posProfile,
}: UsePosCustomerDetailsArgs): PosCustomerDetailsState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const activeKey =
    companyUrl && sessionId && posProfile && customer
      ? JSON.stringify({
          companyUrl,
          customer,
          posProfile,
          reloadKey,
          sessionId,
        })
      : null;
  const requestKey = connectionStatus === "offline" ? null : activeKey;
  const [state, setState] = useState<PosCustomerDetailsRequestState>({
    data: null,
    error: null,
    requestKey: null,
  });
  const reload = useCallback(() => {
    if (connectionStatus !== "offline" && customer && posProfile) {
      setReloadKey((current) => current + 1);
    }
  }, [connectionStatus, customer, posProfile]);

  useEffect(() => {
    if (!companyUrl || !sessionId || !posProfile || !customer || !requestKey) {
      return;
    }

    const controller = new AbortController();

    void getVunaMethod<unknown>(
      companyUrl,
      sessionId,
      "vunapos.api.customer.get_customer_details",
      {
        customer,
        pos_profile: posProfile,
      },
      controller.signal,
    )
      .then((data) => {
        if (!isPosCustomerDetails(data)) {
          throw new Error("The server returned incomplete customer details.");
        }
        setState({ data, error: null, requestKey });
      })
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
              : "Could not load customer details.",
          requestKey,
        }));
      });

    return () => controller.abort();
  }, [
    companyUrl,
    customer,
    invalidateSession,
    posProfile,
    requestKey,
    sessionId,
  ]);

  if (!activeKey) {
    return { data: null, error: null, isLoading: false, reload };
  }

  return {
    ...state,
    data: state.requestKey === activeKey ? state.data : null,
    error: state.requestKey === activeKey ? state.error : null,
    isLoading: Boolean(requestKey) && state.requestKey !== activeKey,
    reload,
  };
}
