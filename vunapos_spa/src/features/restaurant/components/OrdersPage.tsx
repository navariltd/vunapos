import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { cn } from "../../../lib/cn";
import { navigateToOrder } from "../../../lib/stores/navigationStore";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useNow } from "../hooks/useNow";
import { useOpenOrders } from "../hooks/useOrderData";
import { elapsedLabel, sortedServiceTypes } from "../tableStatus";
import { NewOrderButton } from "./NewOrderButton";

// Open orders, oldest first, polled while the page is on screen.
export function OrdersPage({ posProfile }: { posProfile?: string }) {
  const bootstrap = useBootstrapData();
  const [serviceType, setServiceType] = useState<string | null>(null);
  const { data: orders, error, isLoading, refresh } = useOpenOrders(posProfile, serviceType);
  const now = useNow();
  const serviceTypes = sortedServiceTypes(bootstrap.data?.restaurant?.service_types ?? []);

  let body;
  if (!orders && isLoading) {
    body = <EmptyState title="Loading orders" description="Fetching open orders." />;
  } else if (!orders) {
    body = (
      <EmptyState
        title="Orders unavailable"
        description={error || "Open orders could not be loaded."}
        action={<Button onClick={() => void refresh()}>Try again</Button>}
      />
    );
  } else if (!orders.length) {
    body = (
      <EmptyState
        title="No open orders"
        description={serviceType ? `There are no open ${serviceType} orders.` : "Start one with New order or from the floor."}
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-outline-variant overflow-hidden rounded-md border border-outline-variant bg-surface">
        {orders.map((order) => (
          <li key={order.name}>
            <button
              type="button"
              className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-container-low sm:px-4"
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
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 pb-[84px] lg:pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-on-surface">Open orders</h2>
        {bootstrap.data?.restaurant ? <NewOrderButton /> : null}
      </div>
      {serviceTypes.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by service type">
          {[null, ...serviceTypes.map((type) => type.name)].map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={serviceType === value}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3 text-sm font-medium transition-colors",
                serviceType === value
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container",
              )}
              onClick={() => setServiceType(value)}
            >
              {value ?? "All"}
            </button>
          ))}
        </div>
      ) : null}
      {error && orders ? (
        <p className="text-xs text-error" role="status">
          Orders could not be refreshed. Retrying.
        </p>
      ) : null}
      {body}
    </section>
  );
}
