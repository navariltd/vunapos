import { useMemo } from "react";
import { ArrowDownUp, ChevronRight, Search } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { cn } from "../../../lib/cn";
import { navigateToOrder } from "../../../lib/stores/navigationStore";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useFloorPlan } from "../hooks/useFloorPlan";
import { useNow } from "../hooks/useNow";
import { useOpenOrders } from "../hooks/useOrderData";
import { filterOrders, isFiltered } from "../ordersFilter";
import { useOrdersFilterStore } from "../stores/ordersFilterStore";
import { elapsedLabel, sortedServiceTypes } from "../tableStatus";
import { NewOrderButton } from "./NewOrderButton";

const chipClass = (active: boolean) =>
  cn(
    "h-9 shrink-0 rounded-full border px-3 text-sm font-medium transition-colors",
    active ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container",
  );

// Open orders, polled while the page is on screen. Search, sort and filters run on
// this device and are kept while an order is open.
export function OrdersPage({ posProfile }: { posProfile?: string }) {
  const bootstrap = useBootstrapData();
  const filter = useOrdersFilterStore((s) => s.filter);
  const setFilter = useOrdersFilterStore((s) => s.setFilter);
  const clearFilters = useOrdersFilterStore((s) => s.clearFilters);
  const { data: orders, error, isLoading, refresh } = useOpenOrders(posProfile);
  const { plan } = useFloorPlan(posProfile);
  const now = useNow();
  const serviceTypes = sortedServiceTypes(bootstrap.data?.restaurant?.service_types ?? []);
  const currentUser = bootstrap.data?.current_user;

  const floors = (plan?.floors ?? []).filter((floor) => floor.is_active);
  const floorOfTable = useMemo(
    () => new Map((plan?.floors ?? []).flatMap((floor) => floor.tables.map((table) => [table.name, floor.name] as const))),
    [plan],
  );
  const visible = useMemo(
    () => (orders ? filterOrders(orders, filter, { currentUser, floorOfTable }) : null),
    [currentUser, filter, floorOfTable, orders],
  );
  const filtered = isFiltered(filter);

  let body;
  if (!visible && isLoading) {
    body = <EmptyState title="Loading orders" description="Fetching open orders." />;
  } else if (!visible) {
    body = (
      <EmptyState
        title="Orders unavailable"
        description={error || "Open orders could not be loaded."}
        action={<Button onClick={() => void refresh()}>Try again</Button>}
      />
    );
  } else if (!visible.length) {
    body = filtered ? (
      <EmptyState
        title="No matching orders"
        description="No open order matches the search and filters."
        action={<Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
      />
    ) : (
      <EmptyState title="No open orders" description="Start one with New order or from the floor." />
    );
  } else {
    body = (
      <ul className="min-w-0 divide-y divide-outline-variant overflow-hidden rounded-md border border-outline-variant bg-surface">
        {visible.map((order) => (
          <li key={order.name}>
            <button
              type="button"
              className="flex min-h-16 w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-surface-container-low sm:px-4"
              onClick={() => navigateToOrder(order.name)}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-status-occupied-container text-sm font-semibold text-on-surface">
                {order.table_label || "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-on-surface">
                  {order.table_label ? `Table ${order.table_label}` : order.service_type}
                  <span className="font-normal text-on-surface-variant"> · {order.name}</span>
                </span>
                <span className="block truncate text-xs text-on-surface-variant">
                  {[
                    order.table_label ? order.service_type : null,
                    order.pax ? `${order.pax} ${order.pax === 1 ? "guest" : "guests"}` : null,
                    order.waiter_name || order.waiter,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-on-surface-variant">{elapsedLabel(order.opened_at, now)}</span>
              <ChevronRight className="size-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-4 pb-[84px] lg:pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-on-surface">
          Open orders
          {visible && orders ? (
            <span className="font-normal text-on-surface-variant">
              {" "}
              · {filtered ? `${visible.length} of ${orders.length}` : orders.length}
            </span>
          ) : null}
        </h2>
        {bootstrap.data?.restaurant ? <NewOrderButton /> : null}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
          <input
            type="search"
            value={filter.query}
            placeholder="Table, order or customer"
            className="h-11 w-full rounded-md border border-outline-variant bg-surface pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
            onChange={(event) => setFilter({ query: event.target.value })}
          />
        </label>
        <Button
          variant="ghost"
          className="h-11 shrink-0 gap-2 px-3"
          aria-label={filter.sort === "oldest" ? "Oldest first. Show newest first" : "Newest first. Show oldest first"}
          onClick={() => setFilter({ sort: filter.sort === "oldest" ? "newest" : "oldest" })}
        >
          <ArrowDownUp className="size-4" aria-hidden="true" />
          <span className="text-sm">{filter.sort === "oldest" ? "Oldest" : "Newest"}</span>
        </Button>
      </div>

      <div className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-1" role="group" aria-label="Filter orders">
        <button
          type="button"
          aria-pressed={filter.mine}
          className={chipClass(filter.mine)}
          onClick={() => setFilter({ mine: !filter.mine })}
        >
          My orders
        </button>
        {serviceTypes.length > 1 ? (
          <>
            <span className="my-1 w-px shrink-0 bg-outline-variant" aria-hidden="true" />
            {[null, ...serviceTypes.map((type) => type.name)].map((value) => (
              <button
                key={value ?? "all"}
                type="button"
                aria-pressed={filter.serviceType === value}
                className={chipClass(filter.serviceType === value)}
                onClick={() => setFilter({ serviceType: value })}
              >
                {value ?? "All types"}
              </button>
            ))}
          </>
        ) : null}
        {floors.length > 1 ? (
          <>
            <span className="my-1 w-px shrink-0 bg-outline-variant" aria-hidden="true" />
            {[null, ...floors].map((floor) => (
              <button
                key={floor?.name ?? "all-floors"}
                type="button"
                aria-pressed={filter.floor === (floor?.name ?? null)}
                className={chipClass(filter.floor === (floor?.name ?? null))}
                onClick={() => setFilter({ floor: floor?.name ?? null })}
              >
                {floor?.floor_name ?? "All floors"}
              </button>
            ))}
          </>
        ) : null}
      </div>

      {error && orders ? (
        <p className="text-xs text-error" role="status">
          Orders could not be refreshed. Retrying.
        </p>
      ) : null}
      {body}
    </section>
  );
}
