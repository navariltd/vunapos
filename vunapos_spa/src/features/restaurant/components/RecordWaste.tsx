import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  unwrapVunaResponse,
  VunaApiError,
  vunaMethods,
} from "../../../services/vunaApi";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { newId } from "../ids";
import {
  readWaste,
  saveWaste,
  clearWaste,
  type SavedWaste,
  type WasteQuote,
} from "../wasteCommand";

export function RecordWaste({
  ticket,
  allowed,
  onChanged,
}: {
  ticket: string;
  allowed: boolean;
  onChanged: () => void;
}) {
  const preview = useFrappePostCall(vunaMethods.previewRestaurantWaste);
  const record = useFrappePostCall(vunaMethods.recordRestaurantWaste);
  const scope = useOrderDraftStore((state) => state.scope);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const toast = useUiFeedbackStore((state) => state.showToast);
  const [saved] = useState(() => {
    try {
      return { pending: readWaste(scope, ticket), error: "" };
    } catch (error) {
      return { pending: null, error: (error as Error).message };
    }
  });
  const [pending, setPending] = useState<SavedWaste | null>(saved.pending);
  const [quote, setQuote] = useState<WasteQuote | null>(
    saved.pending?.quote || null
  );
  const [values, setValues] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState(saved.error);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const load = async () => {
    setOpen(true);
    if (pending || saved.error) return;
    setBusy(true);
    setError("");
    setQuote(null);
    setValues({});
    try {
      setQuote(unwrapVunaResponse<WasteQuote>(await preview.call({ ticket })));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not review waste quantities."
      );
    } finally {
      setBusy(false);
    }
  };
  const selected = Object.fromEntries(
    Object.entries(values).filter(([, qty]) => qty > 0)
  );
  const invalid = Object.entries(values).some(
    ([line, qty]) =>
      !Number.isFinite(qty) ||
      qty < 0 ||
      qty > (quote?.lines.find((row) => row.line_id === line)?.max_qty || 0)
  );
  const submit = async () => {
    if (running.current || !quote || saved.error) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const request = readWaste(scope, ticket) ||
        pending || {
          command: {
            ticket,
            quantities: selected,
            reason: reason.trim(),
            fingerprint: quote.fingerprint,
            request_key: newId(),
          },
          quote,
        };
      saveWaste(scope, request);
      setPending(request);
      unwrapVunaResponse(await record.call(request.command));
      clearWaste(scope, ticket);
      setPending(null);
      setQuote(null);
      setOpen(false);
      setReason("");
      toast({
        type: "info",
        message:
          "Waste recorded. Stock and the customer's bill have not changed.",
      });
    } catch (caught) {
      if (
        caught instanceof VunaApiError &&
        caught.serverRejected &&
        caught.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        try {
          clearWaste(scope, ticket);
          setPending(null);
        } catch {
          /* Retain uncertain recovery. */
        }
        if (caught.code === "WASTE_REVIEW_CHANGED") setQuote(null);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The result is unconfirmed. Retry the original waste request safely."
      );
    } finally {
      running.current = false;
      setBusy(false);
      changed();
      onChanged();
    }
  };
  if (!allowed && !pending && !saved.error) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => void load()}>
        {pending ? "Review waste request" : "Record waste"}
      </Button>
      <ConfirmDialog
        isOpen={open}
        title="Record billed food as waste"
        description="For served food already charged on a submitted bill. This records a loss and moves its posted cost to waste expense. It does not refund the customer, issue stock again, change kitchen progress or prepare a replacement. Stock add-ons follow their dish."
        confirmLabel={
          pending ? "Retry original waste request" : "Approve and record waste"
        }
        loading={busy}
        confirmDisabled={
          busy ||
          Boolean(saved.error) ||
          !quote ||
          (!pending &&
            (invalid || !Object.keys(selected).length || !reason.trim()))
        }
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onConfirm={() => void submit()}
      >
        <div className="max-h-[45dvh] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          {pending ? (
            <p className="text-sm">
              This request is unconfirmed. Retry it before recording further
              waste. Reason: {pending.command.reason}
            </p>
          ) : null}
          {!quote && !busy ? (
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              Review latest quantities
            </Button>
          ) : null}
          {quote ? (
            <p className="text-xs text-on-surface-variant">
              Bill: {quote.invoice}
              {quote.waste_account ? (
                <span className="block">
                  Waste expense: {quote.waste_account}
                </span>
              ) : null}
            </p>
          ) : null}
          {quote?.lines.map((line) => (
            <label
              key={line.line_id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                {line.item_name}
                <span className="block text-xs text-on-surface-variant">
                  Up to {line.max_qty} {line.uom} served, billed and not already
                  recorded
                </span>
                {line.unit_cost !== undefined ? (
                  <span className="block text-xs text-on-surface-variant">
                    Posted cost per {line.uom}: {quote.currency}{" "}
                    {new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 6,
                    }).format(line.unit_cost)}
                  </span>
                ) : null}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={line.max_qty}
                step="any"
                aria-label={`${line.item_name} waste quantity`}
                className="min-h-10 w-24 shrink-0 rounded-md border border-outline-variant bg-surface px-2"
                value={
                  pending?.command.quantities[line.line_id] ||
                  values[line.line_id] ||
                  0
                }
                disabled={busy || Boolean(pending) || line.max_qty <= 0}
                onChange={(event) =>
                  setValues({
                    ...values,
                    [line.line_id]: Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
          <label className="block text-sm">
            Waste reason
            <textarea
              maxLength={500}
              value={pending?.command.reason || reason}
              disabled={busy || Boolean(pending)}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 block min-h-20 w-full rounded-md border border-outline-variant bg-surface p-2"
            />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}
