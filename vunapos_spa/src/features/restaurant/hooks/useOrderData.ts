import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
  VunaApiError,
  getMenu,
  getTableStatus,
  listRestaurantOrders,
  listRestaurantSessions,
  vunaMethods,
} from "../../../services/vunaApi";
import { deriveTableStatuses } from "../tableStatus";
import type { MenuDTO } from "../types";
import { usePolledData } from "./usePolledData";

// Table status for the floor, polled while the floor is on screen.
export function useTableStatus(posProfile?: string) {
  const call = useFrappePostCall(vunaMethods.getTableStatus);
  const fetcher = useCallback(
    () => getTableStatus(call.call, posProfile || ""),
    [call.call, posProfile]
  );
  const result = usePolledData(
    posProfile ? `status:${posProfile}` : null,
    fetcher
  );
  const statuses = useMemo(
    () => deriveTableStatuses(result.data ?? []),
    [result.data]
  );
  return { ...result, statuses };
}

// All open orders for the Orders page, polled while it is on screen. The page
// filters them on this device (ordersFilter.ts).
export function useOpenOrders(posProfile?: string) {
  const call = useFrappePostCall(vunaMethods.listRestaurantOrders);
  const sessionsCall = useFrappePostCall(vunaMethods.listRestaurantSessions);
  const fetcher = useCallback(async () => {
    const [orders, sessions] = await Promise.all([
      listRestaurantOrders(call.call, {
        pos_profile: posProfile || "",
        status: "Open",
      }),
      listRestaurantSessions(sessionsCall.call, posProfile || ""),
    ]);
    return [
      ...orders.filter((order) => !order.restaurant_session),
      ...sessions.map((session) => ({
        name: session.name,
        restaurant_session: session.name,
        status: "Open" as const,
        service_type: session.service_type,
        table: session.tables[0]?.table ?? null,
        table_label:
          session.tables.map((table) => table.table_label).join(" + ") || null,
        customer: session.customer,
        pax: session.guest_count,
        waiter: session.waiter,
        waiter_name: session.waiter_name,
        opened_at: session.opened_at,
        invoice_doctype: null,
        invoice: null,
        modified: session.modified,
      })),
    ];
  }, [call.call, sessionsCall.call, posProfile]);
  return usePolledData(posProfile ? `orders:${posProfile}` : null, fetcher);
}

// The menu for an order's service type and table (floor). Reloads when either
// changes; `reload` fetches it again after MENU_ITEM_NOT_AVAILABLE.
export function useMenu(
  posProfile?: string,
  serviceType?: string | null,
  table?: string | null,
  customer?: string | null,
  priceList?: string | null
) {
  const call = useFrappePostCall(vunaMethods.getMenu);
  const [revision, setRevision] = useState(0);
  const key =
    posProfile && serviceType
      ? `${posProfile}|${serviceType}|${table || ""}|${customer || ""}|${
          priceList || ""
        }|${revision}`
      : null;
  const [result, setResult] = useState<{
    key: string;
    menu: MenuDTO | null;
    error: string | null;
    code: string | null;
  } | null>(null);

  useEffect(() => {
    if (!key || !posProfile || !serviceType) return undefined;
    let active = true;
    void getMenu(call.call, {
      pos_profile: posProfile,
      service_type: serviceType,
      table,
      customer,
      price_list: priceList,
    })
      .then((menu) => {
        if (active) setResult({ key, menu, error: null, code: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResult({
          key,
          menu: null,
          error:
            error instanceof Error
              ? error.message
              : "The menu could not be loaded.",
          code: error instanceof VunaApiError ? error.code || null : null,
        });
      });
    return () => {
      active = false;
    };
  }, [call.call, key, posProfile, serviceType, table, customer, priceList]);

  const reload = useCallback(() => setRevision((current) => current + 1), []);
  const current = result?.key === key ? result : null;
  return {
    menu: current?.menu ?? null,
    error: current?.error ?? null,
    errorCode: current?.code ?? null,
    isLoading: Boolean(key) && !current,
    reload,
  };
}
