import { useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosProductBundle } from "@/features/pos/types";
import { getVunaMethod } from "@/services/frappeClient";

type Args = {
  customer?: string;
  enabled: boolean;
  itemCode?: string;
  posProfile?: string;
  priceList?: string;
};

/** Loads authoritative components and sellable quantity before a bundle is added. */
export function usePosProductBundle({
  customer,
  enabled,
  itemCode,
  posProfile,
  priceList,
}: Args) {
  const { companyUrl, sessionId } = useAppSession();
  const key =
    enabled && companyUrl && sessionId && itemCode && posProfile
      ? `${companyUrl}:${sessionId}:${itemCode}:${posProfile}:${customer || ""}:${priceList || ""}`
      : null;
  const [state, setState] = useState<{
    data: PosProductBundle | null;
    error: string | null;
    key: string | null;
  }>({ data: null, error: null, key: null });
  useEffect(() => {
    if (!key || !companyUrl || !sessionId || !itemCode || !posProfile) return;
    const controller = new AbortController();
    void getVunaMethod<PosProductBundle>(
      companyUrl,
      sessionId,
      "vunapos.api.item.get_product_bundle",
      {
        customer,
        item_code: itemCode,
        pos_profile: posProfile,
        price_list: priceList,
      },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, key }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Could not load bundle components.",
            key,
          });
      });
    return () => controller.abort();
  }, [companyUrl, customer, itemCode, key, posProfile, priceList, sessionId]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    isLoading: Boolean(key) && state.key !== key,
  };
}
