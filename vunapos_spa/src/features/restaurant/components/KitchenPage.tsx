import { useCallback, useContext, useEffect, useState } from "react";
import {
  FrappeContext,
  useFrappePostCall,
} from "frappe-react-sdk";
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
import type { KitchenTicketDTO } from "../types";

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
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${kitchenStatusClass(
              ticket.status
            )}`}
          >
            {ticket.status}
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
            Waiter: {ticket.waiter}
          </p>
        ) : null}
      </header>
      <ul className="flex-1 divide-y divide-outline-variant px-4">
        {ticket.items.map((item) => (
          <li
            key={item.line_id}
            className={`py-3 ${item.parent_line_id ? "pl-5" : ""}`}
          >
            <p className="text-sm font-semibold">
              {new Intl.NumberFormat(undefined, {
                maximumFractionDigits: 6,
              }).format(item.qty)}{" "}
              {item.uom} × {item.item_name}
            </p>
            {item.parent_line_id ? (
              <p className="text-xs text-on-surface-variant">Add-on</p>
            ) : null}
            {item.modifiers.length ? (
              <p className="mt-1 text-xs">
                {item.modifiers.map((choice) => choice.label).join(" · ")}
              </p>
            ) : null}
            {item.note ? (
              <p className="mt-1 whitespace-pre-wrap rounded bg-tertiary-container p-2 text-sm font-medium text-on-tertiary-container">
                {item.note}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {ticket.order_note ? (
        <p className="mx-4 mb-3 whitespace-pre-wrap rounded bg-error-container p-2 text-sm font-medium text-on-error-container">
          {ticket.order_note}
        </p>
      ) : null}
      <footer className="space-y-2 border-t border-outline-variant p-3">
        <KitchenActions
          ticket={ticket}
          showCancel={false}
          onChanged={onChanged}
        />
        <Button variant="ghost" size="sm" onClick={onOpen}>
          Ticket details
        </Button>
      </footer>
    </article>
  );
}

export function KitchenPage({ posProfile }: { posProfile?: string }) {
  const call = useFrappePostCall(vunaMethods.getKitchenBoard);
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
      <p className="mb-3 text-xs text-on-surface-variant">
        Live station updates with polling recovery. Ready completes native
        manufacture; Served does not issue stock again.
      </p>
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
