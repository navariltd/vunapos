import { useCallback, useEffect, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import {
  PosBootstrapData,
  PosCheckoutFieldDefinition,
} from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type PosBootstrapState = {
  data: PosBootstrapData | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

type PosBootstrapRequestState = Omit<
  PosBootstrapState,
  "isLoading" | "reload"
> & {
  requestKey: string | null;
};

const CHECKOUT_FIELD_DOCTYPES = new Set<PosCheckoutFieldDefinition["doctype"]>([
  "POS Invoice",
  "Sales Invoice",
  "Sales Order",
]);

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Bootstrap data is administrator-configurable. Keep only the safe, supported
 * checkout definitions so a bad row cannot stop the native POS from opening.
 */
export function normalizeCheckoutFields(
  value: unknown,
): PosCheckoutFieldDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const field = candidate as Record<string, unknown>;
    const doctype = optionalText(field.doctype);
    const fieldname = optionalText(field.fieldname);
    const fieldtype = optionalText(field.fieldtype);
    const label = optionalText(field.label);
    if (
      !doctype ||
      !CHECKOUT_FIELD_DOCTYPES.has(
        doctype as PosCheckoutFieldDefinition["doctype"],
      ) ||
      !fieldname ||
      !fieldtype ||
      !label
    )
      return [];

    const order =
      typeof field.order === "number" && Number.isFinite(field.order)
        ? field.order
        : undefined;
    return [
      {
        doctype: doctype as PosCheckoutFieldDefinition["doctype"],
        fieldname,
        fieldtype,
        label,
        ...(optionalText(field.options)
          ? { options: optionalText(field.options) }
          : {}),
        ...(optionalText(field.placeholder)
          ? { placeholder: optionalText(field.placeholder) }
          : {}),
        ...(optionalText(field.help_text)
          ? { help_text: optionalText(field.help_text) }
          : {}),
        ...(typeof field.required === "boolean" ||
        typeof field.required === "number"
          ? { required: Boolean(field.required) }
          : {}),
        ...(order === undefined ? {} : { order }),
      },
    ];
  });
}

function normalizeBootstrap(data: PosBootstrapData): PosBootstrapData {
  return {
    ...data,
    pos_profile: {
      ...data.pos_profile,
      checkout_fields: normalizeCheckoutFields(
        data.pos_profile?.checkout_fields,
      ),
    },
  };
}

export function usePosBootstrap(): PosBootstrapState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey =
    companyUrl && sessionId ? `${companyUrl}:${sessionId}:${reloadKey}` : null;
  const [state, setState] = useState<PosBootstrapRequestState>({
    data: null,
    error: null,
    requestKey: null,
  });

  useEffect(() => {
    if (connectionStatus === "offline" || !companyUrl || !sessionId) {
      return;
    }

    const controller = new AbortController();

    void getVunaMethod<PosBootstrapData>(
      companyUrl,
      sessionId,
      "vunapos.api.pos.get_pos_bootstrap",
      {},
      controller.signal,
    )
      .then((data) =>
        setState({ data: normalizeBootstrap(data), error: null, requestKey }),
      )
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
              : "Could not load the POS workspace.",
          requestKey,
        });
      });

    return () => controller.abort();
  }, [companyUrl, connectionStatus, invalidateSession, requestKey, sessionId]);

  const reload = useCallback(() => {
    if (connectionStatus !== "offline") setReloadKey((current) => current + 1);
  }, [connectionStatus]);

  if (!requestKey)
    return {
      data: null,
      error: "Your session is no longer available. Sign in again to continue.",
      isLoading: false,
      reload,
    };

  if (connectionStatus === "offline") {
    return { data: state.data, error: null, isLoading: false, reload };
  }

  return { ...state, isLoading: state.requestKey !== requestKey, reload };
}
