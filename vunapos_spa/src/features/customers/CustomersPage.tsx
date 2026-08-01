import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Search, Users } from "lucide-react";

import { Button } from "../../components/ui/Button";
import {
  navigateToCustomer,
  navigateToPosPage,
} from "../../lib/stores/navigationStore";
import { unwrapVunaResponse, vunaMethods } from "../../services/vunaApi";
import type { CustomerDirectoryDTO } from "../pos/types";

type Props = { posProfile?: string; defaultCurrency?: string };
const PAGE_SIZE = 25;

function money(value: number, currency?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: currency ? "currency" : "decimal",
    currency: currency || undefined,
  }).format(value);
}

export function CustomersPage({ posProfile, defaultCurrency }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [type, setType] = useState("");
  const [territory, setTerritory] = useState("");
  const [start, setStart] = useState(0);
  const params = {
    pos_profile: posProfile,
    query,
    customer_group: group,
    customer_type: type,
    territory,
    start,
    limit: PAGE_SIZE,
  };
  const response = useFrappeGetCall<unknown>(
    vunaMethods.getCustomerDirectory,
    params,
    posProfile ? ["vunapos_customer_directory", params] : null,
  );
  let directory: CustomerDirectoryDTO | null = null;
  let parseError: string | null = null;
  if (response.data) {
    try {
      directory = unwrapVunaResponse<CustomerDirectoryDTO>(response.data);
    } catch (error) {
      parseError =
        error instanceof Error ? error.message : "Unable to load customers";
    }
  }
  const error = parseError || response.error?.message;

  return (
    <section className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Customers</h2>
            <p className="text-sm text-on-surface-variant">
              Customers and balances you are permitted to view.
            </p>
          </div>
          <Button onClick={() => navigateToPosPage("Home")}>Back to POS</Button>
        </div>
        <div className="grid gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-3 md:grid-cols-[minmax(14rem,1fr)_repeat(3,minmax(9rem,auto))]">
          <label className="flex items-center gap-2 rounded-md border border-outline-variant bg-surface px-3">
            <Search className="size-4 text-on-surface-variant" />
            <input
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              placeholder="Search name, mobile or email"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setStart(0);
              }}
            />
          </label>
          <select
            className="rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm"
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setStart(0);
            }}
          >
            <option value="">All groups</option>
            {(directory?.customer_groups || []).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            className="rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setStart(0);
            }}
          >
            <option value="">All types</option>
            <option>Individual</option>
            <option>Company</option>
          </select>
          <select
            className="rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm"
            value={territory}
            onChange={(event) => {
              setTerritory(event.target.value);
              setStart(0);
            }}
          >
            <option value="">All territories</option>
            {(directory?.territories || []).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {error ? (
          <div className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
            {error}
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-outline-variant">
          <div className="hidden grid-cols-[minmax(12rem,2fr)_1fr_1fr_1fr_1fr] gap-3 bg-surface-container-high px-4 py-3 text-xs font-semibold uppercase text-on-surface-variant md:grid">
            <span>Customer</span>
            <span>Category</span>
            <span>Outstanding</span>
            <span>Loyalty</span>
            <span>Last purchase</span>
          </div>
          {response.isLoading ? (
            <p className="p-6 text-center text-sm text-on-surface-variant">
              Loading customers...
            </p>
          ) : directory?.customers.length ? (
            directory.customers.map((customer) => (
              <article
                key={customer.customer}
                role="button"
                tabIndex={0}
                onClick={() => navigateToCustomer(customer.customer)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    navigateToCustomer(customer.customer);
                }}
                className="grid cursor-pointer gap-2 border-t border-outline-variant px-4 py-3 first:border-t-0 hover:bg-surface-container-low md:grid-cols-[minmax(12rem,2fr)_1fr_1fr_1fr_1fr] md:items-center"
              >
                <div>
                  <p className="font-medium text-on-surface">
                    {customer.customer_name}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {customer.mobile_no ||
                      customer.email_id ||
                      customer.customer}
                  </p>
                </div>
                <div className="text-sm">
                  <p>{customer.customer_group || "Uncategorized"}</p>
                  <p className="text-xs text-on-surface-variant">
                    {customer.customer_type || "-"} ·{" "}
                    {customer.territory || "No territory"}
                  </p>
                </div>
                <div className="text-sm">
                  <span className="md:hidden text-on-surface-variant">
                    Outstanding:{" "}
                  </span>
                  {customer.outstanding_balance == null
                    ? "Restricted"
                    : money(
                        customer.outstanding_balance,
                        customer.currency || defaultCurrency,
                      )}
                </div>
                <div className="text-sm">
                  <span className="md:hidden text-on-surface-variant">
                    Loyalty:{" "}
                  </span>
                  {customer.loyalty_points == null
                    ? "Unavailable"
                    : customer.loyalty_points.toLocaleString()}
                </div>
                <div className="text-sm text-on-surface-variant">
                  {customer.last_purchase_date
                    ? formatDate(customer.last_purchase_date)
                    : "No purchases"}
                </div>
              </article>
            ))
          ) : (
            <div className="p-8 text-center">
              <Users className="mx-auto size-8 text-on-surface-variant" />
              <p className="mt-2 text-sm text-on-surface-variant">
                No customers match these filters.
              </p>
            </div>
          )}
        </div>
        {directory ? (
          <div className="flex items-center justify-between gap-3 text-sm text-on-surface-variant">
            <span>
              {directory.total_count} customer
              {directory.total_count === 1 ? "" : "s"} · Updated{" "}
              {formatDateTime(directory.as_of)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={start === 0}
                onClick={() => setStart(Math.max(0, start - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={start + PAGE_SIZE >= directory.total_count}
                onClick={() => setStart(start + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = value.split(" ")[0];
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function formatTime(value?: string) {
  if (!value) return "";
  const time = value.split(" ")[1] || value;
  const parts = time.split(".")[0].split(":");
  return parts.length >= 2
    ? `${parts[0]}:${parts[1]}:${parts[2] || "00"}`
    : time.split(".")[0];
}

function formatDateTime(value?: string) {
  const time = formatTime(value);
  return time ? `${formatDate(value)} ${time}` : formatDate(value);
}
