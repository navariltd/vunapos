import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosTemplateVariants } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type Args = {
  customer?: string;
  enabled: boolean;
  priceList?: string;
  posProfile?: string;
  templateItemCode?: string;
};

type State = {
  data: PosTemplateVariants | null;
  error: string | null;
  requestKey: string | null;
};

/** Retrieves concrete sellable variants with the same pricing context as the cart. */
export function usePosTemplateVariants({
  customer,
  enabled,
  posProfile,
  priceList,
  templateItemCode,
}: Args) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey =
    enabled && companyUrl && sessionId && posProfile && templateItemCode
      ? `${companyUrl}:${sessionId}:${posProfile}:${templateItemCode}:${customer || ""}:${priceList || ""}:${reloadKey}`
      : null;
  const [state, setState] = useState<State>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (
      !requestKey ||
      !companyUrl ||
      !sessionId ||
      !posProfile ||
      !templateItemCode
    )
      return;
    const controller = new AbortController();

    void getVunaMethod<PosTemplateVariants>(
      companyUrl,
      sessionId,
      "vunapos.api.item.get_template_variants",
      {
        customer,
        pos_profile: posProfile,
        price_list: priceList,
        template_item_code: templateItemCode,
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
              : "Could not load item variants.",
          requestKey,
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    customer,
    invalidateSession,
    posProfile,
    priceList,
    requestKey,
    sessionId,
    templateItemCode,
  ]);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);
  return {
    data: state.requestKey === requestKey ? state.data : null,
    error: state.requestKey === requestKey ? state.error : null,
    isLoading: Boolean(requestKey) && state.requestKey !== requestKey,
    reload,
  };
}
