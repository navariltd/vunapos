import { useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosCheckoutFieldDefinition } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

export type PosCheckoutLinkOption = { label: string; value: string };

/** Searches only Link values approved by the VunaPOS checkout-field endpoint. */
export function useCheckoutLinkOptions(
  field: PosCheckoutFieldDefinition | undefined,
  query: string,
) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [state, setState] = useState<{
    error: string | null;
    key: string | null;
    options: PosCheckoutLinkOption[];
  }>({ error: null, key: null, options: [] });
  const isLink = field?.fieldtype === "Link";
  const doctype = field?.doctype;
  const fieldname = field?.fieldname;
  const requestKey =
    isLink && companyUrl && sessionId && doctype && fieldname
      ? `${companyUrl}:${sessionId}:${doctype}:${fieldname}:${debouncedQuery}`
      : null;

  useEffect(() => {
    if (!isLink) return;
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [isLink, query]);

  useEffect(() => {
    if (!doctype || !fieldname || !companyUrl || !sessionId || !requestKey)
      return;
    const controller = new AbortController();
    void getVunaMethod<PosCheckoutLinkOption[]>(
      companyUrl,
      sessionId,
      "vunapos.api.profile.search_checkout_link_options",
      {
        doctype,
        fieldname,
        query: debouncedQuery,
      },
      controller.signal,
    )
      .then((options) => setState({ error: null, key: requestKey, options }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        ) {
          void invalidateSession();
          return;
        }
        setState({
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not find matching records.",
          key: requestKey,
          options: [],
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    debouncedQuery,
    doctype,
    fieldname,
    invalidateSession,
    requestKey,
    sessionId,
  ]);

  return {
    error: state.key === requestKey ? state.error : null,
    isLoading: Boolean(requestKey && state.key !== requestKey),
    options: state.key === requestKey ? state.options : [],
  };
}
