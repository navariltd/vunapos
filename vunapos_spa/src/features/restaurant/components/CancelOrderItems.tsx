import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  cancelOrderItems,
  previewItemCancellation,
  VunaApiError,
  vunaMethods,
} from "../../../services/vunaApi";
import { ManagerPinDialog } from "../../pos/components/ManagerPinDialog";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { newId } from "../ids";
import { positiveKitchenQuantities } from "../kitchenCommand";
import {
  clearCancellation,
  readCancellation,
  saveCancellation,
  type CancellationQuote,
  type SavedCancellation,
} from "../cancellationCommand";

export function CancelOrderItems({
  order,
  allowed,
  onChanged,
}: {
  order: string;
  allowed: boolean;
  onChanged: () => void;
}) {
  const preview = useFrappePostCall(vunaMethods.previewItemCancellation);
  const cancel = useFrappePostCall(vunaMethods.cancelOrderItems);
  const scope = useOrderDraftStore((state) => state.scope);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const toast = useUiFeedbackStore((state) => state.showToast);
  const [saved] = useState(() => {
    try {
      return { pending: readCancellation(scope, order), error: "" };
    } catch (error) {
      return { pending: null, error: (error as Error).message };
    }
  });
  const [pending, setPending] = useState<SavedCancellation | null>(
    saved.pending
  );
  const [quote, setQuote] = useState<CancellationQuote | null>(
    saved.pending?.quote || null
  );
  const [values, setValues] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState(saved.error);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState(false);
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
      setQuote(await previewItemCancellation(preview.call, order));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The order could not be reviewed. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };
  const selected = positiveKitchenQuantities(values);
  const invalid =
    !quote ||
    Object.entries(values).some(
      ([line, qty]) =>
        !Number.isFinite(qty) ||
        qty < 0 ||
        qty >
          (quote.lines.find((row) => row.line_id === line)?.max_cancel_qty || 0)
    );
  const submit = async (token?: string) => {
    if (running.current || saved.error || !quote) return;
    running.current = true;
    setBusy(true);
    setPin(false);
    setError("");
    try {
      const request = readCancellation(scope, order) ||
        pending || {
          command: {
            order,
            quantities: selected,
            fingerprint: quote.fingerprint,
            request_key: newId(),
            reason: reason.trim(),
          },
          quote,
        };
      saveCancellation(scope, request);
      setPending(request);
      await cancelOrderItems(cancel.call, {
        ...request.command,
        ...(token ? { manager_pin_token: token } : {}),
      });
      clearCancellation(scope, order);
      setPending(null);
      setOpen(false);
      setQuote(null);
      setReason("");
      toast({
        type: "info",
        message:
          "Items cancelled. The remaining order and bill have been updated; the table stays assigned.",
      });
    } catch (caught) {
      if (
        caught instanceof VunaApiError &&
        caught.serverRejected &&
        caught.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        try {
          clearCancellation(scope, order);
          setPending(null);
        } catch {
          /* Keep recovery if clearing fails. */
        }
        if (caught.code === "CANCELLATION_CHANGED") setQuote(null);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The result is not confirmed. Retry the original cancellation safely."
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
      <Button
        size="sm"
        variant="ghost"
        className="text-error"
        onClick={() => void load()}
      >
        {pending ? "Review cancellation" : "Cancel items"}
      </Button>
      <ConfirmDialog
        isOpen={open && !pin}
        danger
        title="Cancel order items"
        description="Cancel quantities that have not been produced or physically transferred. Add-ons follow their dish. This changes what remains to prepare and bill, not the original kitchen history."
        confirmLabel={
          pending ? "Retry original cancellation" : "Cancel selected items"
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
        onConfirm={() => {
          if ((pending?.quote || quote)?.requires_manager_pin) setPin(true);
          else void submit();
        }}
      >
        <div className="max-h-[45dvh] overflow-y-auto overscroll-contain pr-1">
          {error ? (
            <p role="alert" className="mb-3 text-sm text-error">
              {error}
            </p>
          ) : null}
          {pending ? (
            <p className="mb-3 text-sm">
              This cancellation is unconfirmed. Retry the same request before
              changing these quantities. Reason: {pending.command.reason}
            </p>
          ) : null}
          {!quote && !busy ? (
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              Review latest quantities
            </Button>
          ) : null}
          {quote?.lines.map((line) => (
            <label
              key={line.line_id}
              className="mb-3 flex items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 break-words">
                {line.item_name}
                <span className="block text-xs text-on-surface-variant">
                  {line.max_cancel_qty > 0
                    ? `Up to ${line.max_cancel_qty} of ${line.qty} ${line.uom}`
                    : "Already prepared, transferred or otherwise committed — review stock before cancellation."}
                </span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={line.max_cancel_qty}
                step="any"
                aria-label={`${line.item_name} quantity to cancel`}
                className="min-h-10 w-24 shrink-0 rounded-md border border-outline-variant bg-surface px-2"
                disabled={busy || Boolean(pending) || line.max_cancel_qty <= 0}
                value={
                  pending?.command.quantities[line.line_id] ||
                  values[line.line_id] ||
                  0
                }
                onChange={(event) =>
                  setValues({
                    ...values,
                    [line.line_id]: Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
          {!pending ? (
            <label className="block text-sm">
              Reason
              <textarea
                maxLength={500}
                disabled={busy}
                className="mt-1 w-full rounded-md border border-outline-variant bg-surface p-2"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      </ConfirmDialog>
      <ManagerPinDialog
        isOpen={pin}
        action="order_cancel"
        posProfile={(pending?.quote || quote)?.pos_profile}
        onCancel={() => setPin(false)}
        onApproved={(token) => void submit(token)}
      />
    </>
  );
}
