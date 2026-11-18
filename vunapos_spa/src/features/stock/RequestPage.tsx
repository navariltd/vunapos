import { useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Pause, Trash2, Warehouse } from "lucide-react";
import { ItemGrid } from "../pos/components/ItemGrid";
import { ItemSearch } from "../pos/components/ItemSearch";
import { BarcodeScannerDialog } from "../pos/components/BarcodeScannerDialog";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { useConnectivityStore } from "../../lib/stores/connectivityStore";
import {
  addRequestLine,
  loadRequestDraft,
  newRequestDraft,
  saveRequestDraft,
  type RequestDraft,
} from "./requestDraft";
import { RequestCheckout } from "./RequestCheckout";
import { stockMethods, type StockItem, type StockResult } from "./types";

export function StockResultNotice({
  result,
  onWorkflowAction,
  busy,
}: {
  result: StockResult;
  onWorkflowAction?: (action: string) => void;
  busy?: boolean;
}) {
  return (
    <div
      role="status"
      className="rounded-md border border-primary bg-primary/5 p-3 text-sm"
    >
      <p className="font-medium">
        {result.doctype} {result.name}{" "}
        {result.is_held
          ? "held"
          : result.docstatus === 1
          ? "submitted"
          : result.docstatus === 2
          ? "cancelled"
          : "saved as draft"}
        .
      </p>
      {result.is_held ? (
        <p>Resume it from Held requests when you are ready.</p>
      ) : result.inspection_required && result.docstatus === 0 ? (
        <p>
          Quality Inspection is required. Open this draft receipt from Receipts
          to complete its inspections before submission.
        </p>
      ) : result.workflow ? (
        <div className="mt-2 space-y-2">
          <p>
            Workflow: <strong>{result.workflow.state}</strong>
          </p>
          {result.workflow.actions.length && onWorkflowAction ? (
            <div className="flex flex-wrap gap-2">
              {result.workflow.actions.map((row) => (
                <Button
                  key={row.action}
                  disabled={busy}
                  onClick={() => onWorkflowAction(row.action)}
                  title={`Move to ${row.next_state}`}
                >
                  {row.action}
                </Button>
              ))}
            </div>
          ) : result.docstatus === 0 ? (
            <p>No workflow actions are available to you at this stage.</p>
          ) : null}
        </div>
      ) : result.docstatus === 0 ? (
        <p>
          Complete approval or submission in Desk.{" "}
          {result.doctype === "Stock Entry"
            ? "Stock has not yet been received."
            : "The request is not yet ready for fulfillment."}
        </p>
      ) : null}
      <a
        className="mt-1 inline-block underline"
        href={`/desk/${
          result.doctype === "Stock Entry" ? "stock-entry" : "material-request"
        }/${encodeURIComponent(result.name)}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in Desk
      </a>
    </div>
  );
}

export function RequestPage({
  profile,
  warehouse,
  workflow,
  user,
  atTop,
}: {
  profile: string;
  warehouse: string;
  workflow?: string | null;
  user: string;
  atTop: boolean;
}) {
  const scope = JSON.stringify([user, profile, warehouse]);
  const { call: loadCatalogue } = useFrappePostCall(stockMethods.catalogue);
  const { call: scanRequestItem } = useFrappePostCall(
    stockMethods.scanRequestItem
  );
  const { call: applyWorkflowAction } = useFrappePostCall(
    stockMethods.requestWorkflowAction
  );
  const create = useFrappePostCall(stockMethods.createRequest);
  const { call: listHeld } = useFrappePostCall(stockMethods.heldRequests);
  const { call: loadHeld } = useFrappePostCall(stockMethods.heldRequest);
  const [held, setHeld] = useState<Array<{ name: string }>>([]);
  const [draft, setDraft] = useState(() => loadRequestDraft(scope));
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pendingScans, setPendingScans] = useState(0);
  const scansInFlight = useRef(0);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [clear, setClear] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StockResult | null>(null);
  const running = useRef(false);
  const online = useConnectivityStore((s) => s.state === "reachable");
  useEffect(() => {
    let cancelled = false;
    if (online)
      void listHeld({ pos_profile: profile })
        .then((value) => {
          if (!cancelled)
            setHeld(unwrapVunaResponse<Array<{ name: string }>>(value));
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load held requests."
            );
        });
    return () => {
      cancelled = true;
    };
  }, [listHeld, profile, online, result]);
  useEffect(() => {
    saveRequestDraft(scope, draft);
  }, [scope, draft]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadCatalogue({ pos_profile: profile, query })
        .then((value) => {
          if (!cancelled) {
            setItems(unwrapVunaResponse<StockItem[]>(value));
            setError("");
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load request items."
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadCatalogue, profile, query]);
  const invalid =
    !draft.lines.length ||
    draft.lines.some((row) => !Number.isFinite(row.qty) || row.qty <= 0) ||
    !draft.requiredBy;
  const save = async (hold = false) => {
    if (running.current || scansInFlight.current || invalid || !online) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = unwrapVunaResponse<StockResult>(
        await create.call({
          pos_profile: profile,
          request_key: draft.key,
          required_by: draft.requiredBy,
          notes: draft.notes,
          hold,
          draft_name: draft.name,
          draft_modified: draft.modified,
          items: draft.lines.map((row) => ({
            item_code: row.item.item_code,
            qty: row.qty,
            uom: row.uom,
          })),
        })
      );
      setResult(saved);
      setDraft(newRequestDraft());
      setConfirm(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Request could not be confirmed. Retry without changing its items."
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const scan = async (barcode: string) => {
    if (!barcode.trim() || running.current) return;
    if (!online) {
      setError("Barcode scanning requires a connection.");
      return;
    }
    scansInFlight.current += 1;
    setPendingScans(scansInFlight.current);
    setError("");
    try {
      const scanned = unwrapVunaResponse<{
        item: StockItem;
        uom?: string | null;
      }>(
        await scanRequestItem({ pos_profile: profile, barcode: barcode.trim() })
      );
      setDraft((current) => ({
        ...current,
        lines: addRequestLine(current.lines, scanned.item, atTop, scanned.uom),
      }));
      setResult(null);
      setQuery("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to find this barcode. Your request has not changed."
      );
    } finally {
      scansInFlight.current -= 1;
      setPendingScans(scansInFlight.current);
    }
  };
  const resume = async (name: string) => {
    if (!name || running.current || scansInFlight.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const value = unwrapVunaResponse<Omit<RequestDraft, "key">>(
        await loadHeld({ pos_profile: profile, name })
      );
      setDraft({ ...newRequestDraft(), ...value });
      setResult(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to resume this request."
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const advanceWorkflow = async (action: string) => {
    if (
      !result?.modified ||
      running.current ||
      scansInFlight.current ||
      !online
    )
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = unwrapVunaResponse<StockResult>(
        await applyWorkflowAction({
          pos_profile: profile,
          name: result.name,
          action,
          modified: result.modified,
        })
      );
      setResult(updated);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to apply this workflow action. Review the request in Desk before retrying."
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 pb-24 lg:p-4 lg:pb-4">
      {result ? (
        <StockResultNotice
          result={result}
          busy={busy || !online || pendingScans > 0}
          onWorkflowAction={(action) => void advanceWorkflow(action)}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-error-container p-3 text-sm text-on-error-container"
        >
          {error}
        </p>
      ) : null}
      {!online ? (
        <p role="status" className="text-sm text-error">
          Connect to the server to create a stock request.
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]">
        <section
          className="min-h-0 space-y-3 overflow-y-auto"
          aria-label="Request catalogue"
        >
          <ItemSearch
            value={query}
            onChange={setQuery}
            onScan={(barcode) => void scan(barcode)}
            onOpenCamera={() => {
              if (!busy) setScannerOpen(true);
            }}
            isLoading={loading || pendingScans > 0}
            view={view}
            onViewChange={setView}
          />
          <ItemGrid
            items={items}
            isLoading={loading}
            ignoreStock
            hidePricing
            view={view}
            onAddItem={(selected) => {
              if (busy) return;
              const item = items.find(
                (row) => row.item_code === selected.item_code
              );
              if (!item) return;
              setResult(null);
              setDraft((current) => ({
                ...current,
                lines: addRequestLine(current.lines, item, atTop),
              }));
            }}
          />
        </section>
        <section
          className="flex min-h-0 flex-col gap-3 rounded-md border border-outline-variant p-3"
          aria-label="Material request items"
        >
          <div
            className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-3 py-3"
            aria-label="Request warehouse"
          >
            <Warehouse
              className="size-5 shrink-0 text-on-surface-variant"
              aria-hidden="true"
            />
            <label className="min-w-0 flex-1 text-xs text-on-surface-variant">
              Warehouse
              <input
                aria-label="Destination warehouse"
                readOnly
                value={warehouse}
                className="mt-1 block w-full border-0 bg-transparent text-sm font-medium text-on-surface outline-none"
              />
            </label>
          </div>
          {held.length ? (
            <label className="text-sm">
              Held requests
              <select
                aria-label="Resume held request"
                value=""
                disabled={
                  busy || pendingScans > 0 || !online || draft.lines.length > 0
                }
                onChange={(event) => void resume(event.target.value)}
                className="mt-1 h-touch w-full rounded-md border border-outline-variant bg-surface px-3"
              >
                <option value="">Select a request to resume</option>
                {held.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name}
                  </option>
                ))}
              </select>
              {draft.lines.length > 0 ? (
                <span className="text-xs text-on-surface-variant">
                  Hold or clear this cart before resuming another request.
                </span>
              ) : null}
            </label>
          ) : null}
          <div className="min-h-32 flex-1 space-y-3 overflow-y-auto">
            {!draft.lines.length ? (
              <div className="rounded-md border border-dashed border-outline-variant bg-surface-container-low p-6 text-center">
                <p className="text-sm font-medium text-on-surface">
                  Cart is empty
                </p>
              </div>
            ) : null}
            {draft.lines.map((row, index) => (
              <div
                key={index}
                className="space-y-2 rounded-md bg-surface-container-low p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {row.item.item_name}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {row.item.item_code}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${row.item.item_name}`}
                    className="cursor-pointer text-error"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        lines: current.lines.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <label className="flex-1 text-xs">
                    Quantity
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      disabled={busy}
                      value={row.qty || ""}
                      className="mt-1 h-10 w-full rounded-md border border-outline-variant bg-surface px-2 text-sm"
                      onChange={(e) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((line, i) =>
                            i === index
                              ? { ...line, qty: Number(e.target.value) }
                              : line
                          ),
                        }))
                      }
                    />
                  </label>
                  <label className="flex-1 text-xs">
                    UOM
                    <select
                      value={row.uom}
                      disabled={busy}
                      className="mt-1 h-10 w-full rounded-md border border-outline-variant bg-surface px-2 text-sm"
                      onChange={(e) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((line, i) =>
                            i === index
                              ? { ...line, uom: e.target.value }
                              : line
                          ),
                        }))
                      }
                    >
                      {row.item.uoms.map((unit) => (
                        <option key={unit.uom} value={unit.uom}>
                          {unit.uom}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 shrink-0 border-t border-outline-variant bg-surface pt-4">
            <div className="grid grid-cols-2 gap-2" aria-label="Cart actions">
              <Button
                variant="ghost"
                className="gap-2 bg-tertiary text-on-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container"
                disabled={busy || pendingScans > 0 || invalid || !online}
                onClick={() => void save(true)}
              >
                <Pause className="size-4" />
                Hold
              </Button>
              <Button
                variant="danger"
                className="gap-2"
                disabled={busy || pendingScans > 0 || !draft.lines.length}
                onClick={() => setClear(true)}
              >
                <Trash2 className="size-4" />
                Clear Cart
              </Button>
              <div className="col-span-2">
                <Button
                  className="w-full"
                  disabled={busy || pendingScans > 0 || invalid || !online}
                  onClick={() => setConfirm(true)}
                >
                  Checkout
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
      {confirm ? (
        <RequestCheckout
          draft={draft}
          warehouse={warehouse}
          workflow={workflow}
          busy={busy}
          disabled={invalid || pendingScans > 0 || !online}
          error={
            error ||
            (!online ? "Connect to the server to submit this request." : "")
          }
          onChange={setDraft}
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
          onSubmit={() => void save()}
        />
      ) : null}
      {scannerOpen ? (
        <BarcodeScannerDialog
          open
          onClose={() => setScannerOpen(false)}
          onDetected={(barcode) => void scan(barcode)}
        />
      ) : null}
      <ConfirmDialog
        isOpen={clear}
        title="Clear request"
        description="Discard this unsaved request draft? Your sales cart will not be changed."
        danger
        onCancel={() => setClear(false)}
        onConfirm={() => {
          setDraft(newRequestDraft());
          setClear(false);
        }}
      />
    </div>
  );
}
