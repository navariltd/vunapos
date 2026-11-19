import { useCallback, useContext, useEffect, useState } from "react";
import { FrappeContext, useFrappePostCall } from "frappe-react-sdk";
import { Clock3, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { getKitchenBoard, vunaMethods } from "../../../services/vunaApi";
import { usePolledData } from "../hooks/usePolledData";
import { useNow } from "../hooks/useNow";
import { kitchenStatusClass } from "../kitchenStatus";
import { subscribeKitchenStation } from "../kitchenRealtime";
import { KitchenActions } from "./KitchenActions";
import { KitchenTicketSheet } from "./KitchenTicketSheet";
import { KitchenDishes } from "./KitchenDishes";
import type { KitchenTicketDTO } from "../types";
import { pendingKitchenTickets } from "../kitchenCommand";
import { useOrderDraftStore } from "../stores/orderDraftStore";

function StationSubscription({
  name,
  refresh,
}: {
  name: string;
  refresh: () => Promise<void>;
}) {
  const context = useContext(FrappeContext);
  const socket = context?.socket;
  useEffect(() => {
    if (!socket) return;
    return subscribeKitchenStation(socket, name, refresh);
  }, [socket, name, refresh]);
  return null;
}

export function KitchenTicketCard({
  ticket,
  now,
  onOpen,
  onChanged,
}: {
  ticket: KitchenTicketDTO;
  now: Date;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const minutes = Math.max(
    0,
    Math.floor(
      (now.getTime() - new Date(ticket.sent_at.replace(" ", "T")).getTime()) /
        60000
    )
  );
  return (
    <article className="flex flex-col rounded-xl border border-outline-variant bg-surface shadow-sm">
      <header className="border-b border-outline-variant p-4">
        {ticket.remake_of ? (
          <p className="mb-2 text-sm font-semibold text-primary">
            Remake · {ticket.remake_of}
          </p>
        ) : null}
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            className="min-w-0 cursor-pointer text-left"
            onClick={onOpen}
          >
            <h3 className="truncate font-semibold">
              {ticket.table_labels
                ? `Table ${ticket.table_labels}`
                : ticket.service_type || "Takeaway"}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {ticket.name} · {ticket.station_label}
            </p>
          </button>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${kitchenStatusClass(
                ticket.status
              )}`}
            >
              {ticket.status}
            </span>
            {ticket.production_completed_at_billing ? (
              <span
                title="Billed before it was made. Its stock already moved; kitchen steps only update the status."
                className="rounded-full bg-status-paid-container px-2 py-1 text-xs font-semibold text-on-surface"
              >
                Paid
              </span>
            ) : null}
          </span>
        </div>
        <p
          className={`mt-2 flex items-center gap-1 text-xs ${
            minutes >= 20
              ? "font-semibold text-error"
              : "text-on-surface-variant"
          }`}
        >
          <Clock3 className="size-3" aria-hidden="true" />
          {Number.isFinite(minutes) ? minutes : "—"} min · {ticket.sales_order}
        </p>
        {ticket.waiter ? (
          <p className="mt-1 truncate text-xs text-on-surface-variant">
            Waiter: {ticket.waiter_name || ticket.waiter}
          </p>
        ) : null}
      </header>
      <KitchenActions ticket={ticket} showCancel={false} onChanged={onChanged}>
        <div className="px-4">
          <KitchenDishes ticket={ticket} />
        </div>
        {ticket.order_note ? (
          <p className="mx-4 mb-3 whitespace-pre-wrap rounded bg-error-container p-2 text-sm font-medium text-on-error-container">
            {ticket.order_note}
          </p>
        ) : null}
      </KitchenActions>
      <footer className="space-y-2 border-t border-outline-variant p-3">
        <Button variant="ghost" size="sm" onClick={onOpen}>
          Ticket details
        </Button>
      </footer>
    </article>
  );
}

export function KitchenPage({ posProfile }: { posProfile?: string }) {
  const call = useFrappePostCall(vunaMethods.getKitchenBoard);
  const scope = useOrderDraftStore((state) => state.scope);
  const [station, setStation] = useState("");
  const [history, setHistory] = useState(false);
  const [start, setStart] = useState(0);
  const [ticket, setTicket] = useState<string | null>(null);
  const now = useNow(15000);
  const fetcher = useCallback(
    () =>
      getKitchenBoard(call.call, {
        pos_profile: posProfile || "",
        station: station || undefined,
        history: history ? 1 : 0,
        start,
      }),
    [call.call, posProfile, station, history, start]
  );
  const result = usePolledData(
    posProfile ? `kitchen:${posProfile}:${station}:${history}:${start}` : null,
    fetcher
  );
  let pendingTickets: string[] = [];
  let recoveryError = false;
  try {
    pendingTickets = pendingKitchenTickets(scope);
  } catch {
    recoveryError = true;
  }
  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto p-4 pb-24 lg:pb-4">
      {(result.data?.stations || [])
        .filter((row) => !station || row.name === station)
        .slice(0, 20)
        .map((row) => (
          <StationSubscription
            key={row.name}
            name={row.name}
            refresh={result.refresh}
          />
        ))}
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold">Kitchen</h2>
        {result.data?.can_manage_availability ? (
          <a
            className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-surface-container"
            href="/desk/restaurant-availability"
            target="_blank"
            rel="noreferrer"
          >
            Ordering availability
          </a>
        ) : null}
        <label className="text-sm">
          <span className="sr-only">Kitchen station</span>
          <select
            className="min-h-10 max-w-64 rounded-md border border-outline-variant bg-surface px-3"
            value={station}
            onChange={(event) => {
              setStation(event.target.value);
              setStart(0);
            }}
          >
            <option value="">All permitted stations</option>
            {result.data?.stations.map((row) => (
              <option key={row.name} value={row.name}>
                {row.station_name}
                {row.enabled ? "" : " (disabled)"}
                {row.ordering_paused ? " · Orders paused" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={history}
            onChange={(event) => {
              setHistory(event.target.checked);
              setStart(0);
            }}
          />
          Include completed
        </label>
        <Button
          variant="ghost"
          onClick={() => void result.refresh()}
          aria-label="Refresh kitchen"
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>
      {result.data?.stations
        .filter(
          (row) => row.ordering_paused && (!station || row.name === station)
        )
        .map((row) => (
          <div
            key={row.name}
            role="status"
            className="mb-3 rounded-md border border-outline-variant bg-surface-container p-3 text-sm"
          >
            <p className="font-semibold">
              {row.station_name} · New orders paused
            </p>
            <p>{row.availability_reason}</p>
            <p className="text-xs text-on-surface-variant">
              Existing tickets can still be prepared and served.
              {row.unavailable_until
                ? ` Resumes ${row.unavailable_until}.`
                : ""}
            </p>
          </div>
        ))}
      <p className="mb-3 text-xs text-on-surface-variant">
        Mark meals ready as they finish, then mark them served as they leave the
        kitchen.
      </p>
      {recoveryError ? (
        <p role="alert" className="mb-3 text-sm text-error">
          Kitchen recovery storage could not be read. Check browser storage
          before taking another action.
        </p>
      ) : null}
      {pendingTickets.length ? (
        <div className="mb-3 rounded-lg border border-outline-variant p-3 text-sm">
          <p className="mb-2">
            Review unconfirmed kitchen actions before updating these tickets. A
            completed ticket may no longer appear on the active board.
          </p>
          <div className="flex flex-wrap gap-2">
            {pendingTickets.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                onClick={() => setTicket(name)}
              >
                Review {name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {result.error ? (
        <p
          role="alert"
          className="mb-3 rounded bg-error-container p-3 text-sm text-on-error-container"
        >
          {result.error}
        </p>
      ) : null}
      {!result.data && result.isLoading ? (
        <EmptyState
          title="Loading kitchen"
          description="Fetching preparation tickets."
        />
      ) : result.data && !result.data.stations.length ? (
        <EmptyState
          title="No permitted kitchen stations"
          description="Ask a manager to configure stations or check your Branch and Kitchen Station User Permissions."
        />
      ) : result.data && !result.data.tickets.length ? (
        <EmptyState
          title="No tickets waiting"
          description="New placed orders appear here automatically."
        />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {result.data?.tickets.map((row) => (
            <KitchenTicketCard
              key={row.name}
              ticket={row}
              now={now}
              onOpen={() => setTicket(row.name)}
              onChanged={() => void result.refresh()}
            />
          ))}
        </div>
      )}
      {start > 0 || result.data?.has_more ? (
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={!start}
            onClick={() => setStart((current) => Math.max(0, current - 100))}
          >
            Previous
          </Button>
          <Button
            disabled={!result.data?.has_more}
            onClick={() => setStart((current) => current + 100)}
          >
            Next 100 tickets
          </Button>
        </div>
      ) : null}
      {ticket ? (
        <KitchenTicketSheet
          key={ticket}
          name={ticket}
          onClose={() => {
            setTicket(null);
            void result.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
