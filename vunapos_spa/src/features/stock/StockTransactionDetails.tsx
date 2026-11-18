import { useCallback, useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ReceiveStockDialog } from "./ReceiveStockDialog";
import { receivableDrafts, type AcceptedQuantity } from "./receiving";
import { useConnectivityStore } from "../../lib/stores/connectivityStore";
import { applyDelta } from "../../lib/cacheEngine";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { StockResultNotice } from "./RequestPage";
import {
  navigateToStock,
  navigateToRequestEdit,
  stockPath,
  type StockView,
} from "./navigation";
import { StockStatus } from "./stockUi";
import { stockDate, stockQty } from "./stockFormatting";
import {
  stockMethods,
  type MaterialRequestDetails,
  type StockEntryDetails,
  type StockResult,
} from "./types";

export function StockTransferItems({
  items,
  canViewRequests,
}: {
  items: StockEntryDetails["items"];
  canViewRequests: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-surface-container-low text-xs text-on-surface-variant">
          <tr>
            <th className="p-3">Item / request</th>
            <th className="p-3">Sent quantity</th>
            <th className="p-3">Stock quantity</th>
            <th className="p-3">Received</th>
            <th className="p-3">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.name} className="border-t border-outline-variant">
              <td className="p-3">
                <p className="font-medium">{row.item_name}</p>
                <p className="text-xs text-on-surface-variant">
                  {row.item_code}
                </p>
                {canViewRequests ? (
                  <a
                    className="mt-1 block text-xs underline"
                    href={stockPath("requests", row.material_request)}
                    onClick={(event) => {
                      if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        navigateToStock("requests", row.material_request);
                      }
                    }}
                  >
                    {row.material_request}
                  </a>
                ) : (
                  <p className="text-xs text-on-surface-variant">
                    {row.material_request}
                  </p>
                )}
                {row.batch_no ? (
                  <p className="mt-1 text-xs">Batch: {row.batch_no}</p>
                ) : null}
                {row.serial_no ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs">
                    Serial: {row.serial_no}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-on-surface-variant">
                  {row.source_warehouse} → {row.transit_warehouse}
                </p>
              </td>
              <td className="p-3">
                {stockQty(row.qty)} {row.uom}
              </td>
              <td className="p-3">
                {stockQty(row.stock_qty)} {row.stock_uom}
              </td>
              <td className="p-3">
                {stockQty(row.received_qty)} {row.stock_uom}
              </td>
              <td className="p-3 font-semibold">
                {stockQty(row.remaining_qty)} {row.stock_uom}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RequestDraftActions({
  request,
  disabled,
  onEdit,
  onSubmit,
}: {
  request: MaterialRequestDetails | null;
  disabled: boolean;
  onEdit: () => void;
  onSubmit: () => void;
}) {
  if (request?.result.docstatus !== 0) return null;
  return (
    <>
      {request.can_edit ? (
        <Button variant="ghost" disabled={disabled} onClick={onEdit}>
          Edit
        </Button>
      ) : null}
      {request.can_submit ? (
        <Button disabled={disabled} onClick={onSubmit}>
          Submit Request
        </Button>
      ) : null}
    </>
  );
}

export function StockTransactionDetails({
  profile,
  warehouse,
  view,
  name,
  canViewRequests,
}: {
  profile: string;
  warehouse: string;
  view: StockView;
  name: string;
  canViewRequests: boolean;
}) {
  const { call: loadRequest } = useFrappePostCall(stockMethods.requestDetails);
  const { call: loadTransfer } = useFrappePostCall(
    stockMethods.stockEntryDetails
  );
  const { call: receive } = useFrappePostCall(stockMethods.endTransit);
  const { call: advance } = useFrappePostCall(
    stockMethods.requestWorkflowAction
  );
  const { call: submitRequest } = useFrappePostCall(stockMethods.submitRequest);
  const [request, setRequest] = useState<MaterialRequestDetails | null>(null);
  const [transfer, setTransfer] = useState<StockEntryDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StockResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const running = useRef(false);
  const online = useConnectivityStore((state) => state.state === "reachable");
  const reload = useCallback(async () => {
    if (view === "requests")
      setRequest(
        unwrapVunaResponse<MaterialRequestDetails>(
          await loadRequest({ pos_profile: profile, name })
        )
      );
    else
      setTransfer(
        unwrapVunaResponse<StockEntryDetails>(
          await loadTransfer({ pos_profile: profile, stock_entry: name })
        )
      );
  }, [loadRequest, loadTransfer, profile, view, name]);
  useEffect(() => {
    let cancelled = false;
    const load =
      view === "requests"
        ? loadRequest({ pos_profile: profile, name })
        : loadTransfer({ pos_profile: profile, stock_entry: name });
    void load
      .then((value) => {
        if (cancelled) return;
        if (view === "requests")
          setRequest(unwrapVunaResponse<MaterialRequestDetails>(value));
        else setTransfer(unwrapVunaResponse<StockEntryDetails>(value));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load this stock transaction."
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadRequest, loadTransfer, profile, view, name]);
  const act = async (
    action?: string,
    quantities?: AcceptedQuantity[],
    requestKey?: string
  ) => {
    if (running.current || !online) return;
    if (view === "transfers" && !transfer?.fingerprint) return;
    if (
      view === "requests" &&
      (!request?.result.modified || (!action && !request.can_submit))
    )
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const value =
        view === "requests"
          ? action
            ? await advance({
                pos_profile: profile,
                name,
                action,
                modified: request?.result.modified,
              })
            : await submitRequest({
                pos_profile: profile,
                name,
                modified: request?.result.modified,
              })
          : await receive({
              pos_profile: profile,
              stock_entry: name,
              review: transfer?.fingerprint,
              quantities,
              request_key: requestKey,
            });
      const saved = unwrapVunaResponse<StockResult>(value);
      setResult(saved);
      setConfirm(false);
      setSubmitOpen(false);
      if (view === "requests")
        setRequest((current) =>
          current ? { ...current, result: saved } : current
        );
      if (view === "transfers" && saved.docstatus === 1)
        void applyDelta().catch(() => {
          /* Receipt succeeded; background catalogue refresh can retry separately. */
        });
      try {
        await reload();
      } catch {
        setError(
          "The action succeeded, but the details could not refresh. Use Refresh before taking another action."
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action could not be confirmed. Refresh and review before retrying."
      );
      if (view === "requests") {
        setConfirm(false);
        setSubmitOpen(false);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const state =
    request?.result.workflow?.state ||
    (request?.result.docstatus === 0
      ? "Draft"
      : request?.result.docstatus === 2
      ? "Cancelled"
      : request?.result.status) ||
    transfer?.status ||
    "";
  const draftReceipts = receivableDrafts(transfer?.receipts || []);
  const pendingReceipt = draftReceipts[0];
  return (
    <section className="h-full min-h-0 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <button
              type="button"
              aria-label="Back to stock transactions"
              disabled={busy}
              className="mt-1 cursor-pointer"
              onClick={() => navigateToStock(view)}
            >
              <ArrowLeft className="size-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold">{name}</h1>
              {state ? (
                <div className="mt-2">
                  <StockStatus
                    status={state}
                    workflow={Boolean(request?.result.workflow)}
                  />
                </div>
              ) : null}
              <p className="mt-2 text-sm text-on-surface-variant">
                {view === "requests"
                  ? "Material Request"
                  : "Stock Entry · Material Transfer"}
                {request || transfer
                  ? ` · ${stockDate(
                      request?.transaction_date || transfer?.posting_date || ""
                    )}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <RequestDraftActions
              request={request}
              disabled={busy || !online}
              onEdit={() => navigateToRequestEdit(name)}
              onSubmit={() => setSubmitOpen(true)}
            />
            <Button
              variant="ghost"
              disabled={busy || loading}
              onClick={() => {
                setBusy(true);
                setError("");
                void reload()
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Unable to refresh."
                    )
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Refresh
            </Button>
            <a
              className="inline-flex h-touch items-center rounded-md bg-surface-container px-4 text-sm font-medium"
              href={`/desk/${
                view === "requests" ? "material-request" : "stock-entry"
              }/${encodeURIComponent(name)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Desk
            </a>
          </div>
        </header>
        {loading ? (
          <p role="status" className="p-6 text-on-surface-variant">
            Loading stock transaction…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-error-container p-3 text-sm text-on-error-container"
          >
            {error}
          </p>
        ) : null}
        {result ? <StockResultNotice result={result} /> : null}
        {request || transfer ? (
          <>
            <dl className="grid gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: "Destination warehouse", value: warehouse },
                {
                  label: "Company",
                  value: request?.company || transfer?.company,
                },
                {
                  label: "Created by",
                  value: request?.owner || transfer?.owner,
                },
                ...(request
                  ? [
                      {
                        label: "Required by",
                        value: stockDate(request.required_by),
                      },
                    ]
                  : [
                      {
                        label: "Source warehouse",
                        value: transfer?.from_warehouse || "See items",
                      },
                      {
                        label: "Transit warehouse",
                        value: transfer?.to_warehouse || "See items",
                      },
                    ]),
              ].map((field) => (
                <div key={field.label}>
                  <dt className="text-xs text-on-surface-variant">
                    {field.label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium">
                    {field.value || "—"}
                  </dd>
                </div>
              ))}
            </dl>
            {request?.has_other_warehouses || transfer?.has_other_warehouses ? (
              <p className="rounded-md bg-tertiary-container p-3 text-sm text-on-tertiary-container">
                Only items for {warehouse} are shown. The full document includes
                other warehouses.
              </p>
            ) : null}
            {request?.result.docstatus === 0 && request.edit_reason ? (
              <p className="text-sm text-on-surface-variant">
                {request.edit_reason}
              </p>
            ) : null}
            {request?.result.workflow ? (
              <section className="space-y-3 rounded-lg border border-outline-variant p-4">
                <h2 className="font-semibold">Workflow</h2>
                <p className="text-sm text-on-surface-variant">
                  {request.result.workflow.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  {request.result.workflow.actions.map((row) => (
                    <Button
                      key={row.action}
                      disabled={busy || !online}
                      title={`Move to ${row.next_state}`}
                      onClick={() => void act(row.action)}
                    >
                      {row.action}
                    </Button>
                  ))}
                </div>
                {!request.result.workflow.actions.length &&
                request.result.docstatus === 0 ? (
                  <p className="text-sm text-on-surface-variant">
                    No workflow actions are available to you at this stage.
                  </p>
                ) : null}
              </section>
            ) : null}
            {request ? (
              <>
                <h2 className="font-semibold">Requested items</h2>
                <div className="overflow-x-auto rounded-lg border border-outline-variant">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-surface-container-low text-xs text-on-surface-variant">
                      <tr>
                        <th className="p-3">Item</th>
                        <th className="p-3">Requested quantity</th>
                        <th className="p-3">Stock quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {request.items.map((row) => (
                        <tr
                          key={row.name}
                          className="border-t border-outline-variant"
                        >
                          <td className="p-3">
                            <p className="font-medium">{row.item_name}</p>
                            <p className="text-xs text-on-surface-variant">
                              {row.item_code}
                            </p>
                          </td>
                          <td className="p-3">
                            {stockQty(row.qty)} {row.uom}
                          </td>
                          <td className="p-3">
                            {stockQty(row.stock_qty)} {row.stock_uom}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {request.transfers.length ? (
                  <section className="space-y-2 rounded-lg border border-outline-variant p-4">
                    <h2 className="font-semibold">Recent stock transfers</h2>
                    {request.transfers.map((row) => (
                      <a
                        key={row.name}
                        href={stockPath("transfers", row.name)}
                        onClick={(event) => {
                          if (!event.ctrlKey && !event.metaKey) {
                            event.preventDefault();
                            navigateToStock("transfers", row.name);
                          }
                        }}
                        className="flex flex-wrap justify-between gap-3 rounded-md p-2 text-sm hover:bg-surface-container-low"
                      >
                        <span className="font-medium underline">
                          {row.name}
                        </span>
                        <span>{stockDate(row.posting_date)}</span>
                      </a>
                    ))}
                  </section>
                ) : null}
              </>
            ) : null}
            {transfer ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Transfer items</h2>
                    <p className="text-xs text-on-surface-variant">
                      Received and remaining quantities are in each item’s stock
                      UOM.
                    </p>
                  </div>
                  {transfer.fingerprint && !pendingReceipt ? (
                    <Button
                      disabled={busy || !online}
                      onClick={() => {
                        setError("");
                        setConfirm(true);
                      }}
                    >
                      End Transit
                    </Button>
                  ) : null}
                  {pendingReceipt && transfer.fingerprint ? (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (draftReceipts.length === 1)
                          navigateToStock(
                            "transfers",
                            name,
                            pendingReceipt.name
                          );
                        else
                          document
                            .getElementById("stock-receipts")
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                      }}
                    >
                      {draftReceipts.length === 1
                        ? "Continue Receipt"
                        : "Review draft receipts"}
                    </Button>
                  ) : null}
                </div>
                <StockTransferItems
                  items={transfer.items}
                  canViewRequests={canViewRequests}
                />
                {transfer.receipts.some(
                  (row) => row.docstatus === 0 && row.has_other_warehouses
                ) ? (
                  <p className="rounded-md bg-tertiary-container p-3 text-sm text-on-tertiary-container">
                    A draft receipt includes other warehouses and must be
                    reviewed in Desk. End Transit here receives only this POS
                    warehouse’s remaining items in a separate receipt; the mixed
                    draft is not changed. Recheck that draft’s quantities in
                    Desk before submitting it.
                  </p>
                ) : null}
                {pendingReceipt ? (
                  <p className="rounded-md bg-tertiary-container p-3 text-sm text-on-tertiary-container">
                    {draftReceipts.length > 1
                      ? "Multiple draft receipts exist. Open the receipt you want to review and complete. Other drafts will not be submitted or deleted."
                      : "A draft receipt already exists. Open it to review its quantities and complete receipt."}
                  </p>
                ) : null}
                {transfer.receipts.length ? (
                  <section
                    id="stock-receipts"
                    className="space-y-2 rounded-lg border border-outline-variant p-4"
                  >
                    <h2 className="font-semibold">Receipts</h2>
                    {transfer.receipts.map((row) => (
                      <a
                        key={row.name}
                        href={
                          row.docstatus === 0 && row.has_other_warehouses
                            ? `/desk/stock-entry/${encodeURIComponent(
                                row.name
                              )}`
                            : stockPath("transfers", name, row.name)
                        }
                        target={
                          row.docstatus === 0 && row.has_other_warehouses
                            ? "_blank"
                            : undefined
                        }
                        rel={
                          row.docstatus === 0 && row.has_other_warehouses
                            ? "noreferrer"
                            : undefined
                        }
                        onClick={(event) => {
                          if (row.docstatus === 0 && row.has_other_warehouses)
                            return;
                          if (
                            !event.ctrlKey &&
                            !event.metaKey &&
                            !event.shiftKey
                          ) {
                            event.preventDefault();
                            navigateToStock("transfers", name, row.name);
                          }
                        }}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md p-2 text-sm hover:bg-surface-container-low"
                      >
                        <span className="font-medium underline">
                          {row.name}
                        </span>
                        <span>{stockDate(row.posting_date)}</span>
                        <StockStatus
                          status={row.docstatus === 1 ? "Submitted" : "Draft"}
                        />
                        <span className="underline">
                          {row.docstatus === 0 && row.has_other_warehouses
                            ? "Review in Desk"
                            : row.docstatus === 0
                            ? "Open draft receipt"
                            : "View receipt"}
                        </span>
                      </a>
                    ))}
                  </section>
                ) : null}
              </>
            ) : null}
            {request?.notes || transfer?.remarks ? (
              <section className="space-y-2 rounded-lg border border-outline-variant p-4">
                <h2 className="font-semibold">Notes</h2>
                <p className="whitespace-pre-wrap text-sm">
                  {request?.notes || transfer?.remarks}
                </p>
              </section>
            ) : null}
          </>
        ) : null}
        <ConfirmDialog
          isOpen={submitOpen}
          title="Submit Material Request?"
          description={`Submit ${name} with the quantities shown? This requests a stock transfer; it does not move stock.`}
          confirmLabel="Submit Request"
          loading={busy}
          confirmDisabled={!online}
          onCancel={() => setSubmitOpen(false)}
          onConfirm={() => void act()}
        />
        {confirm && transfer ? (
          <ReceiveStockDialog
            transfer={transfer}
            busy={busy}
            online={online}
            error={error}
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
            onReceive={(quantities, key) =>
              void act(undefined, quantities, key)
            }
          />
        ) : null}
      </div>
    </section>
  );
}
