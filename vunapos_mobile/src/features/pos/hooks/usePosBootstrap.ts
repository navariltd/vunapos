import { useCallback, useEffect, useMemo, useRef } from "react";

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

export const POS_BOOTSTRAP_DELTA_TTL_MS = 60 * 1000;

type PosBootstrapState = {
  data: PosBootstrapData | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing?: boolean;
  isStale?: boolean;
  lastUpdated?: number | null;
  reload: (options?: { full?: boolean }) => void | Promise<void>;
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

function rowKey(row: Record<string, unknown>) {
  return String(row.item_code ?? row.customer ?? row.name ?? "");
}

function mergeRows<T>(
  existing: T[] | undefined,
  changed: T[] | undefined,
  deleted: string[] | undefined,
): T[] | undefined {
  if (existing === undefined && changed === undefined) return undefined;
  const rows = new Map<string, T>();
  for (const row of existing ?? []) {
    if (row && typeof row === "object") {
      const key = rowKey(row as Record<string, unknown>);
      if (key) rows.set(key, row);
    }
  }
  for (const row of changed ?? []) {
    if (row && typeof row === "object") {
      const key = rowKey(row as Record<string, unknown>);
      if (key) rows.set(key, row);
    }
  }
  for (const key of deleted ?? []) rows.delete(key);
  return [...rows.values()];
}

/**
 * Applies the same timestamp delta shape returned by the SPA bootstrap API.
 * A delta replaces only changed/deleted rows and keeps the cached snapshot
 * otherwise intact; configuration values from the latest response win.
 */
export function mergePosBootstrapDelta(
  cached: PosBootstrapData | null | undefined,
  incoming: PosBootstrapData,
): PosBootstrapData {
  if (!cached || incoming.mode !== "delta") return incoming;
  const deleted = incoming.deleted ?? {};
  return {
    ...cached,
    ...incoming,
    mode: "full",
    items: mergeRows(
      cached.items,
      incoming.items,
      deleted.Item,
    ),
    customers: mergeRows(
      cached.customers,
      incoming.customers,
      deleted.Customer,
    ),
    tax_templates: mergeRows(
      cached.tax_templates,
      incoming.tax_templates,
      deleted["Sales Taxes and Charges Template"],
    ),
    item_tax_templates: mergeRows(
      cached.item_tax_templates,
      incoming.item_tax_templates,
      deleted["Item Tax Template"],
    ),
    deleted: undefined,
  };
}

export function usePosBootstrap(): PosBootstrapState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const forceFullRefreshRef = useRef(false);
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
    async (signal: AbortSignal, cached?: PosBootstrapData | null) => {
      if (!companyUrl || !sessionId) {
        throw new Error(
          "Your session is no longer available. Sign in again to continue.",
        );
      }
      try {
        const since = forceFullRefreshRef.current ? undefined : cached?.server_time;
        let data = await getVunaMethod<PosBootstrapData>(
          companyUrl,
          sessionId,
          "vunapos.api.pos.get_pos_bootstrap",
          since ? { since } : {},
          signal,
        );
        // A schema/configuration revision invalidates the timestamp window. The
        // second request is a normal full snapshot, matching the SPA recovery path.
        if (
          since &&
          cached?.bootstrap_version !== undefined &&
          data.bootstrap_version !== undefined &&
          data.bootstrap_version !== cached.bootstrap_version
        ) {
          data = await getVunaMethod<PosBootstrapData>(
            companyUrl,
            sessionId,
            "vunapos.api.pos.get_pos_bootstrap",
            {},
            signal,
          );
        }
        return normalizeBootstrap(
          mergePosBootstrapDelta(cached, normalizeBootstrap(data)),
        );
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
    ttlMs: POS_BOOTSTRAP_DELTA_TTL_MS,
  });
  const refreshResource = resource.refresh;
  const reload = useCallback(
    async (options?: { full?: boolean }) => {
      forceFullRefreshRef.current = Boolean(options?.full);
      try {
        await refreshResource();
      } finally {
        forceFullRefreshRef.current = false;
      }
    },
    [refreshResource],
  );
  // Older cached bootstrap responses predate the normalized top-level field.
  // Normalize after reading the cache as well as inside `load`, so a valid
  // cached workspace immediately receives its configured default customer.
  const data = useMemo(
    () => (resource.data ? normalizeBootstrap(resource.data) : null),
    [resource.data],
  );
  useEffect(
    () =>
      registerRealtimeRefresh("workspace-configuration", () =>
        reload({ full: true }),
      ),
    [reload],
  );

  if (!cacheKey)
    return {
      data: null,
      error: "Your session is no longer available. Sign in again to continue.",
      isLoading: false,
      reload,
    };

  return {
    data,
    error: resource.error,
    isLoading: resource.isLoading,
    isRefreshing: resource.isRefreshing,
    isStale: resource.isStale,
    lastUpdated: resource.lastUpdated,
    reload,
  };
}
