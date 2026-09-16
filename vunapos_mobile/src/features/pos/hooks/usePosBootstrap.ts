import { useCallback, useEffect, useMemo } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCachedResource } from "@/hooks/usePosCachedResource";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { registerRealtimeRefresh } from "@/sync/realtimeInvalidation";
import {
  PosBootstrapData,
  PosCheckoutFieldDefinition,
  PosDefaultCustomer,
} from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

type PosBootstrapState = {
  data: PosBootstrapData | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing?: boolean;
  isStale?: boolean;
  lastUpdated?: number | null;
  reload: () => void;
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

function normalizeDefaultCustomer(
  value: PosDefaultCustomer | string | null | undefined,
): PosDefaultCustomer | null | undefined {
  if (typeof value === "string") {
    return { customer: value, customer_name: value };
  }
  return value;
}

function normalizeBootstrap(data: PosBootstrapData): PosBootstrapData {
  // The Frappe bootstrap contract carries this on the POS Profile. Keep a
  // normalized top-level copy because the mobile workspace consumes one
  // bootstrap shape, including previously cached payloads.
  const defaultCustomer = normalizeDefaultCustomer(
    data.pos_profile?.default_customer ?? data.default_customer,
  );
  return {
    ...data,
    default_customer: defaultCustomer,
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
  const cacheKey =
    companyUrl && sessionId
      ? {
          resource: "workspace-configuration",
          scope: {
            companyUrl,
            // Frappe's SID is the currently authenticated account context.
            // It is never stored in this cache; it only scopes its records.
            userId: sessionId,
            posProfile: "workspace",
          },
        }
      : null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!companyUrl || !sessionId) {
        throw new Error(
          "Your session is no longer available. Sign in again to continue.",
        );
      }
      try {
        const data = await getVunaMethod<PosBootstrapData>(
          companyUrl,
          sessionId,
          "vunapos.api.pos.get_pos_bootstrap",
          {},
          signal,
        );
        return normalizeBootstrap(data);
      } catch (error) {
        if (error instanceof FrappeClientError && error.code === "session") {
          void invalidateSession();
        }
        throw error;
      }
    },
    [companyUrl, invalidateSession, sessionId],
  );
  const resource = usePosCachedResource({
    cacheKey,
    connectionStatus,
    load,
  });
  // Older cached bootstrap responses predate the normalized top-level field.
  // Normalize after reading the cache as well as inside `load`, so a valid
  // cached workspace immediately receives its configured default customer.
  const data = useMemo(
    () => (resource.data ? normalizeBootstrap(resource.data) : null),
    [resource.data],
  );
  useEffect(
    () =>
      registerRealtimeRefresh("workspace-configuration", resource.refresh),
    [resource.refresh],
  );

  if (!cacheKey)
    return {
      data: null,
      error: "Your session is no longer available. Sign in again to continue.",
      isLoading: false,
      reload: resource.refresh,
    };

  return {
    data,
    error: resource.error,
    isLoading: resource.isLoading,
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    lastUpdated: resource.lastUpdated,
    reload: resource.refresh,
  };
}
