import { useCallback, useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useConnectivityStore } from "../../lib/stores/connectivityStore";
import { applyDelta } from "../../lib/cacheEngine";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { navigateToStock, stockPath } from "./navigation";
import { StockStatus } from "./stockUi";
import { stockDate, stockQty } from "./stockFormatting";
import { QualityInspectionDialog } from "./QualityInspectionDialog";
import { stockMethods, type ReceiptDetails, type StockResult } from "./types";

export function ReceiptActions({
  receipt,
  disabled,
  onChoose,
}: {
  receipt: ReceiptDetails;
  disabled: boolean;
  onChoose: (action: string) => void;
}) {
  if (receipt.docstatus !== 0 || receipt.blocking_reason) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {receipt.workflow ? (
        receipt.workflow.actions.map((row) => (
          <Button
            key={row.action}
            disabled={disabled}
            title={`Move to ${row.next_state}`}
            onClick={() => onChoose(row.action)}
          >
            {row.action}
          </Button>
        ))
      ) : receipt.can_submit ? (
        <Button disabled={disabled} onClick={() => onChoose("")}>
          Submit Receipt
        </Button>
      ) : null}
    </div>
  );
}

export function ReceiptInspection({
  inspection,
  onOpen,
}: {
  inspection: ReceiptDetails["items"][number]["inspection"];
  onOpen?: () => void;
}) {
  if (!inspection) return <span className="text-on-surface-variant">—</span>;
  return (
    <div className="space-y-2">
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
          inspection.blocked
            ? "bg-tertiary-container text-on-tertiary-container"
            : "bg-surface-container-high text-on-surface"
        }`}
      >
        {inspection.status}
      </span>
      {inspection.view_url || inspection.create_url ? (
        <Button variant="ghost" size="sm" onClick={onOpen}>
          {inspection.view_url ? "View Inspection" : "Create Inspection"}
        </Button>
      ) : inspection.required && inspection.blocked ? (
        <p className="text-xs text-on-surface-variant">
          An authorised inspector must complete this inspection.
        </p>
      ) : null}
    </div>
  );
}

export function StockReceiptDetails({
  profile,
  source,
  name,
}: {
  profile: string;
  source: string;
  name: string;
}) {
  const { call: load } = useFrappePostCall(stockMethods.receiptDetails);
  const { call: complete } = useFrappePostCall(stockMethods.completeReceipt);
  const [receipt, setReceipt] = useState<ReceiptDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [inspectionRow, setInspectionRow] = useState<string | null>(null);
  const running = useRef(false);
  const online = useConnectivityStore((state) => state.state === "reachable");
  const reload = useCallback(
    async () =>
      setReceipt(
        unwrapVunaResponse<ReceiptDetails>(
          await load({
            pos_profile: profile,
            stock_entry: source,
            receipt: name,
          })
        )
      ),
    [load, profile, source, name]
  );
  useEffect(() => {
    let cancelled = false;
    void load({ pos_profile: profile, stock_entry: source, receipt: name })
      .then((value) => {
        if (!cancelled) setReceipt(unwrapVunaResponse<ReceiptDetails>(value));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to open this receipt."
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, profile, source, name]);
  const submit = async () => {
    if (!receipt || action === null || running.current || !online) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = unwrapVunaResponse<StockResult>(
        await complete({
          pos_profile: profile,
          stock_entry: source,
          receipt: name,
          review: receipt.review,
          action: action || undefined,
        })
      );
      setAction(null);
      setMessage(
        saved.docstatus === 1
          ? `Receipt ${saved.name} submitted. Stock has been received.`
          : `Receipt ${saved.name} updated. Review its next workflow action.`
      );
      if (saved.docstatus === 1) {
        setReceipt((current) =>
          current
            ? {
                ...current,
                docstatus: 1,
                can_submit: false,
                workflow: undefined,
              }
            : current
        );
        void applyDelta().catch(() => {
          /* Receipt succeeded; catalogue refresh can retry separately. */
        });
      }
      try {
        await reload();
      } catch {
        setError(
          "The action succeeded, but the details could not refresh. Refresh before taking another action."
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The receipt could not be confirmed. Refresh before retrying."
      );
      setAction(null);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="h-full min-h-0 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <button
              type="button"
              aria-label="Back to source transfer"
              disabled={busy}
              className="mt-1 cursor-pointer"
              onClick={() => navigateToStock("transfers", source)}
            >
              <ArrowLeft className="size-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold">{name}</h1>
              <p className="mt-1 text-sm text-on-surface-variant">
                Stock receipt
                {receipt ? ` · ${stockDate(receipt.posting_date)}` : ""}
              </p>
              {receipt ? (
                <div className="mt-2">
                  <StockStatus
                    status={
                      receipt.workflow?.state ||
                      (receipt.docstatus === 1 ? "Submitted" : "Draft")
                    }
                    workflow={Boolean(receipt.workflow)}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
              href={`/desk/stock-entry/${encodeURIComponent(name)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Desk
            </a>
          </div>
        </header>
        {loading ? <p role="status">Loading stock receipt…</p> : null}
        {inspectionRow ? (
          <QualityInspectionDialog
            key={inspectionRow}
            profile={profile}
            source={source}
            receipt={name}
            row={inspectionRow}
            online={online}
            onClose={() => setInspectionRow(null)}
            onSaved={reload}
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
        {message ? (
          <p
            role="status"
            className="rounded-md border border-primary bg-primary/5 p-3 text-sm"
          >
            {message}
          </p>
        ) : null}
        {receipt ? (
          <>
            <dl className="grid gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-on-surface-variant">
                  Source transfer
                </dt>
                <dd className="mt-1 text-sm font-medium">
                  <a
                    className="underline"
                    href={stockPath("transfers", source)}
                    onClick={(event) => {
                      if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        navigateToStock("transfers", source);
                      }
                    }}
                  >
                    {source}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-on-surface-variant">
                  Destination warehouse
                </dt>
                <dd className="mt-1 text-sm font-medium">
                  {receipt.warehouse}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-on-surface-variant">Company</dt>
                <dd className="mt-1 text-sm font-medium">{receipt.company}</dd>
              </div>
            </dl>
            {receipt.blocking_reason ? (
              <p
                role="alert"
                className="rounded-md bg-error-container p-3 text-sm text-on-error-container"
              >
                {receipt.blocking_reason}
              </p>
            ) : null}
            {receipt.inspection_messages?.length ? (
              <div
                className="space-y-1 rounded-md bg-tertiary-container p-3 text-sm text-on-tertiary-container"
                role="status"
              >
                {receipt.inspection_messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
                <p className="mt-2">
                  Open each required inspection below, record its results and
                  submit it here.
                </p>
              </div>
            ) : null}
            {receipt.has_other_warehouses ? (
              <p className="text-sm text-on-surface-variant">
                Only items for this profile warehouse are shown. This
                mixed-warehouse receipt must be completed in Desk.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Receipt items</h2>
                {receipt.workflow ? (
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Workflow: {receipt.workflow.name}
                  </p>
                ) : null}
              </div>
              <ReceiptActions
                receipt={receipt}
                disabled={busy || !online}
                onChoose={setAction}
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-outline-variant">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-surface-container-low text-xs text-on-surface-variant">
                  <tr>
                    <th className="p-3">Item</th>
                    <th className="p-3">From transit warehouse</th>
                    <th className="p-3">Receipt quantity</th>
                    <th className="p-3">Stock quantity</th>
                    <th className="p-3">Quality inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((row) => (
                    <tr
                      key={row.name}
                      className="border-t border-outline-variant"
                    >
                      <td className="p-3">
                        <p className="font-medium">{row.item_name}</p>
                        <p className="text-xs text-on-surface-variant">
                          {row.item_code}
                        </p>
                        {row.batch_no ? (
                          <p className="text-xs">Batch: {row.batch_no}</p>
                        ) : null}
                        {row.serial_no ? (
                          <p className="whitespace-pre-wrap text-xs">
                            Serial: {row.serial_no}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-3">{row.source_warehouse}</td>
                      <td className="p-3">
                        {stockQty(row.qty)} {row.uom}
                      </td>
                      <td className="p-3 font-medium">
                        {stockQty(row.stock_qty)} {row.stock_uom}
                      </td>
                      <td className="p-3">
                        <ReceiptInspection
                          inspection={row.inspection}
                          onOpen={() => setInspectionRow(row.name)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {receipt.docstatus === 0 &&
            !receipt.blocking_reason &&
            !receipt.inspection_messages?.length &&
            !receipt.can_submit &&
            !receipt.workflow?.actions.length ? (
              <p className="text-sm text-on-surface-variant">
                You do not currently have a permitted submit or workflow action
                for this receipt.
              </p>
            ) : null}
          </>
        ) : null}
        <ConfirmDialog
          isOpen={action !== null}
          title={action || "Submit Receipt"}
          description={
            action
              ? `Apply “${action}” to ${name}?`
              : `Submit ${name} and receive the listed stock into ${
                  receipt?.warehouse || "the profile warehouse"
                }?`
          }
          confirmLabel={action || "Submit Receipt"}
          loading={busy}
          confirmDisabled={
            !online || busy || !receipt || Boolean(receipt.blocking_reason)
          }
          onCancel={() => {
            if (!busy) setAction(null);
          }}
          onConfirm={() => void submit()}
        >
          <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {receipt?.items.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span>{row.item_name}</span>
                <strong>
                  {stockQty(row.stock_qty)} {row.stock_uom}
                </strong>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      </div>
    </section>
  );
}
