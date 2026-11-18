import { useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../components/ui/Button";
import {
  navigateToPosPage,
  useNavigationStore,
} from "../../lib/stores/navigationStore";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { navigateToStock, stockRoute, type StockView } from "./navigation";
import { StockTransactionDetails } from "./StockTransactionDetails";
import { StockReceiptDetails } from "./StockReceiptDetails";
import { RequestPage } from "./RequestPage";
import { StockStatus } from "./stockUi";
import { stockDate, stockFieldClass } from "./stockFormatting";
import {
  stockMethods,
  type MaterialRequestRow,
  type TransitRow,
} from "./types";

type Filters = {
  query: string;
  from_date: string;
  to_date: string;
  status: string;
  warehouse: string;
};
const empty: Filters = {
  query: "",
  from_date: "",
  to_date: "",
  status: "",
  warehouse: "",
};
function readFilters(profile: string, view: StockView): Filters {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`vunapos:stock-filters:${profile}:${view}`) ||
        "null"
    );
    return Object.fromEntries(
      Object.entries(empty).map(([key, value]) => [
        key,
        typeof saved?.[key] === "string" ? saved[key] : value,
      ])
    ) as Filters;
  } catch {
    return { ...empty };
  }
}
export function StockOperationsPage({
  profile,
  warehouse,
  canReceive,
  canViewRequests,
  user = "",
  atTop = false,
}: {
  profile: string;
  warehouse: string;
  canReceive: boolean;
  canViewRequests: boolean;
  user?: string;
  atTop?: boolean;
}) {
  const path = useNavigationStore((state) => state.currentPath);
  const route = stockRoute(path);
  const view: StockView = route.view || (canReceive ? "transfers" : "requests");
  const permitted = view === "requests" ? canViewRequests : canReceive;
  const { call: listRequests } = useFrappePostCall(stockMethods.listRequests);
  const { call: listTransfers } = useFrappePostCall(stockMethods.listTransit);
  const [filtersByView, setFilters] = useState(() => ({
    requests: readFilters(profile, "requests"),
    transfers: readFilters(profile, "transfers"),
  }));
  const filters = filtersByView[view];
  const [pages, setPages] = useState({ requests: 0, transfers: 0 });
  const start = pages[view];
  const [rows, setRows] = useState<Array<MaterialRequestRow | TransitRow>>([]);
  const [fetching, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState("");
  const queryKey = JSON.stringify([profile, view, start, filters]);
  const loading = fetching || loadedKey !== queryKey;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `vunapos:stock-filters:${profile}:${view}`,
        JSON.stringify(filters)
      );
    } catch {
      /* Optional browser storage. */
    }
  }, [profile, view, filters]);
  useEffect(() => {
    if (!permitted || route.name) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const load = view === "requests" ? listRequests : listTransfers;
      void load({
        pos_profile: profile,
        start,
        query: filters.query,
        from_date: filters.from_date || undefined,
        to_date: filters.to_date || undefined,
        ...(view === "requests"
          ? { docstatus: filters.status }
          : { progress: filters.status, transit_warehouse: filters.warehouse }),
      })
        .then((value) => {
          if (!cancelled)
            setRows(
              unwrapVunaResponse<Array<MaterialRequestRow | TransitRow>>(value)
            );
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setRows([]);
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load stock transactions."
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setLoadedKey(queryKey);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    listRequests,
    listTransfers,
    profile,
    view,
    start,
    filters,
    permitted,
    route.name,
    revision,
    queryKey,
  ]);
  const update = (field: keyof Filters, value: string) => {
    setFilters((current) => ({
      ...current,
      [view]: { ...current[view], [field]: value },
    }));
    setPages((current) => ({ ...current, [view]: 0 }));
  };
  const clear = () => {
    setFilters((current) => ({ ...current, [view]: { ...empty } }));
    setPages((current) => ({ ...current, [view]: 0 }));
  };
  const visible = rows.slice(0, 20);
  if (route.name && route.editing && permitted)
    return (
      <RequestPage
        key={`${profile}:${route.name}`}
        profile={profile}
        warehouse={warehouse}
        user={user}
        atTop={atTop}
        requestName={route.name}
      />
    );
  if (route.name && permitted)
    if (route.receipt)
      return (
        <StockReceiptDetails
          key={`${profile}:${route.name}:${route.receipt}`}
          profile={profile}
          source={route.name}
          name={route.receipt}
        />
      );
  if (route.name && permitted)
    return (
      <StockTransactionDetails
        key={`${profile}:${view}:${route.name}`}
        profile={profile}
        warehouse={warehouse}
        view={view}
        name={route.name}
        canViewRequests={canViewRequests}
      />
    );
  return (
    <section className="h-full min-h-0 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Stock Transactions</h1>
            <p className="text-sm text-on-surface-variant">
              {view === "requests"
                ? "Review Material Requests"
                : "Review incoming stock and POS receipt history"}{" "}
              for {warehouse}.
            </p>
          </div>
          <Button onClick={() => navigateToPosPage("Home")}>Back to POS</Button>
        </header>
        <div
          className="flex overflow-x-auto border-b border-outline-variant"
          role="tablist"
          aria-label="Stock views"
        >
          {(
            [
              ["requests", "Material Requests", canViewRequests],
              ["transfers", "Stock Entries", canReceive],
            ] as const
          ).map(([key, label, allowed]) =>
            allowed ? (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className={`cursor-pointer whitespace-nowrap px-5 py-3 text-sm font-medium transition-colors hover:text-primary ${
                  view === key
                    ? "border-b-2 border-primary text-primary"
                    : "text-on-surface-variant"
                }`}
                onClick={() => navigateToStock(key)}
              >
                {label}
              </button>
            ) : null
          )}
        </div>
        {!permitted ? (
          <p role="alert">You do not have access to this stock view.</p>
        ) : (
          <>
            <div className="grid items-end gap-3 rounded-lg border border-outline-variant p-4 sm:grid-cols-2 lg:grid-cols-4">
              <input
                aria-label={
                  view === "requests" ? "Request number" : "Stock Entry number"
                }
                placeholder={
                  view === "requests" ? "Request number" : "Stock Entry number"
                }
                value={filters.query}
                onChange={(event) => update("query", event.target.value)}
                className={stockFieldClass}
              />
              <label className="flex min-w-0 flex-col gap-1 text-xs text-on-surface-variant">
                From date
                <input
                  type="date"
                  value={filters.from_date}
                  onChange={(event) => update("from_date", event.target.value)}
                  className={stockFieldClass}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs text-on-surface-variant">
                To date
                <input
                  type="date"
                  value={filters.to_date}
                  onChange={(event) => update("to_date", event.target.value)}
                  className={stockFieldClass}
                />
              </label>
              <select
                aria-label={
                  view === "requests" ? "Document status" : "Receipt status"
                }
                value={filters.status}
                onChange={(event) => update("status", event.target.value)}
                className={stockFieldClass}
              >
                <option value="">
                  {view === "requests"
                    ? "All document statuses"
                    : "All receipt statuses"}
                </option>
                {view === "requests" ? (
                  <>
                    <option value="0">Draft</option>
                    <option value="1">Submitted</option>
                    <option value="2">Cancelled</option>
                  </>
                ) : (
                  <>
                    <option value="unreceived">Not received</option>
                    <option value="partial">Partially received</option>
                    <option value="received">Received</option>
                  </>
                )}
              </select>
              {view === "transfers" ? (
                <input
                  aria-label="Transit warehouse"
                  placeholder="Transit warehouse"
                  value={filters.warehouse}
                  onChange={(event) => update("warehouse", event.target.value)}
                  className={stockFieldClass}
                />
              ) : null}
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() => setRevision((value) => value + 1)}
              >
                Refresh
              </Button>
            </div>
            {error ? (
              <p
                role="alert"
                className="rounded-md bg-error-container p-3 text-sm text-on-error-container"
              >
                {error}
              </p>
            ) : null}
            {!loading && !error ? (
              <div
                className={`grid gap-3 sm:grid-cols-2 ${
                  view === "requests" ? "lg:grid-cols-3" : "lg:grid-cols-4"
                }`}
              >
                {[
                  { label: "Documents on this page", value: visible.length },
                  {
                    label:
                      view === "requests"
                        ? "Draft requests on this page"
                        : "Unreceived transfers on this page",
                    value: visible.filter((row) =>
                      view === "requests"
                        ? (row as MaterialRequestRow).docstatus === 0
                        : (row as TransitRow).receipt_status ===
                          "Awaiting receipt"
                    ).length,
                  },
                  {
                    label:
                      view === "requests"
                        ? "Submitted requests on this page"
                        : "Partial receipts on this page",
                    value: visible.filter((row) =>
                      view === "requests"
                        ? (row as MaterialRequestRow).docstatus === 1
                        : (row as TransitRow).receipt_status ===
                          "Partially received"
                    ).length,
                  },
                  ...(view === "transfers"
                    ? [
                        {
                          label: "Received transfers on this page",
                          value: visible.filter(
                            (row) =>
                              (row as TransitRow).receipt_status === "Received"
                          ).length,
                        },
                      ]
                    : []),
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-lg border border-outline-variant bg-surface-container-low p-4"
                  >
                    <p className="text-xs text-on-surface-variant">
                      {metric.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{metric.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-outline-variant">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-surface-container-low text-xs text-on-surface-variant">
                  <tr>
                    <th className="px-3 py-3">
                      {view === "requests" ? "Request" : "Stock Entry"}
                    </th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">
                      {view === "requests" ? "Required by" : "Source warehouse"}
                    </th>
                    {view === "transfers" ? (
                      <th className="px-3 py-3">Transit warehouse</th>
                    ) : null}
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && !error
                    ? visible.map((row) => (
                        <tr
                          key={row.name}
                          tabIndex={0}
                          className="h-16 cursor-pointer border-t border-outline-variant hover:bg-surface-container-low focus-visible:bg-surface-container-low"
                          onClick={() => navigateToStock(view, row.name)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              navigateToStock(view, row.name);
                            }
                          }}
                        >
                          <td className="px-3 py-3 font-medium">
                            <a
                              href={`/vunapos/stock-transfers/${view}/${encodeURIComponent(
                                row.name
                              )}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (
                                  !event.ctrlKey &&
                                  !event.metaKey &&
                                  !event.shiftKey
                                ) {
                                  event.preventDefault();
                                  navigateToStock(view, row.name);
                                }
                              }}
                            >
                              {row.name}
                            </a>
                          </td>
                          <td className="px-3 py-3">
                            {stockDate(
                              view === "requests"
                                ? (row as MaterialRequestRow).transaction_date
                                : (row as TransitRow).posting_date
                            )}
                          </td>
                          <td
                            className="max-w-[16rem] truncate px-3 py-3"
                            title={
                              view === "requests"
                                ? undefined
                                : (row as TransitRow).from_warehouse
                            }
                          >
                            {view === "requests"
                              ? stockDate(
                                  (row as MaterialRequestRow).schedule_date
                                )
                              : (row as TransitRow).from_warehouse ||
                                "See items"}
                          </td>
                          {view === "transfers" ? (
                            <td
                              className="max-w-[16rem] truncate px-3 py-3"
                              title={(row as TransitRow).to_warehouse}
                            >
                              {(row as TransitRow).to_warehouse || "See items"}
                            </td>
                          ) : null}
                          <td className="px-3 py-3">
                            <StockStatus
                              status={
                                view === "requests"
                                  ? (row as MaterialRequestRow).display_status
                                  : (row as TransitRow).receipt_status
                              }
                              workflow={
                                view === "requests" &&
                                (row as MaterialRequestRow).workflow_enabled
                              }
                            />
                          </td>
                        </tr>
                      ))
                    : null}
                  <tr>
                    {loading ? (
                      <td
                        colSpan={5}
                        className="p-6 text-center text-sm text-on-surface-variant"
                        role="status"
                      >
                        Loading stock transactions…
                      </td>
                    ) : !error && !visible.length ? (
                      <td
                        colSpan={5}
                        className="p-6 text-center text-on-surface-variant"
                      >
                        No{" "}
                        {view === "requests"
                          ? "requests"
                          : "incoming transfers"}{" "}
                        match these filters.
                      </td>
                    ) : null}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-on-surface-variant">
                Page {Math.floor(start / 20) + 1}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={loading || start === 0}
                  onClick={() =>
                    setPages((current) => ({
                      ...current,
                      [view]: Math.max(0, start - 20),
                    }))
                  }
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  disabled={loading || rows.length <= 20}
                  onClick={() =>
                    setPages((current) => ({ ...current, [view]: start + 20 }))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
