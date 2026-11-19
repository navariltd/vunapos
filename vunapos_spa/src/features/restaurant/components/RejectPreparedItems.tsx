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
  readRejection,
  saveRejection,
  clearRejection,
  type SavedRejection,
  type RejectionQuote,
  type RejectionCommand,
} from "../rejectionCommand";

export function RejectPreparedItems({
  ticket,
  allowed,
  onChanged,
}: {
  ticket: string;
  allowed: boolean;
  onChanged: () => void;
}) {
  const preview = useFrappePostCall(vunaMethods.previewRejection);
  const request = useFrappePostCall(vunaMethods.rejectPreparedItems);
  const scope = useOrderDraftStore((s) => s.scope);
  const changed = useOrderDraftStore((s) => s.markOrdersChanged);
  const toast = useUiFeedbackStore((s) => s.showToast);
  const [saved] = useState(() => {
    try {
      return { pending: readRejection(scope, ticket), error: "" };
    } catch (error) {
      return { pending: null, error: (error as Error).message };
    }
  });
  const [pending, setPending] = useState<SavedRejection | null>(saved.pending);
  const [quote, setQuote] = useState<RejectionQuote | null>(
    saved.pending?.quote || null
  );
  const [values, setValues] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState<RejectionCommand["charge"] | "">("");
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
      setQuote(
        unwrapVunaResponse<RejectionQuote>(await preview.call({ ticket }))
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not review rejected food."
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
    if (running.current || !quote || saved.error || (!pending && !charge))
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const command = readRejection(scope, ticket) ||
        pending || {
          command: {
            ticket,
            quantities: selected,
            fingerprint: quote.fingerprint,
            request_key: newId(),
            reason: reason.trim(),
            charge: charge as RejectionCommand["charge"],
          },
          quote,
        };
      saveRejection(scope, command);
      setPending(command);
      unwrapVunaResponse(await request.call(command.command));
      clearRejection(scope, ticket);
      setPending(null);
      setQuote(null);
      setOpen(false);
      setReason("");
      setCharge("");
      toast({
        type: "info",
        message:
          command.command.charge === "Remove charge"
            ? "Rejected food recorded. Its charge and proportional add-on charges were waived. Review the updated bill."
            : "Rejected food recorded. The charge is unchanged.",
      });
    } catch (cause) {
      if (
        cause instanceof VunaApiError &&
        cause.serverRejected &&
        cause.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        try {
          clearRejection(scope, ticket);
          setPending(null);
        } catch {
          /* Keep uncertain recovery. */
        }
        if (cause.code === "REJECTION_REVIEW_CHANGED") setQuote(null);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "The result is unconfirmed. Retry the original rejection safely."
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
        {pending ? "Review rejection request" : "Reject prepared items"}
      </Button>
      <ConfirmDialog
        isOpen={open}
        title="Reject prepared food"
        description="Record food the guest will not accept, without requesting a replacement. Choose what the guest should pay. This does not return food to stock or refund a payment."
        confirmLabel={
          pending ? "Retry original rejection" : "Approve rejection"
        }
        loading={busy}
        confirmDisabled={
          busy ||
          Boolean(saved.error) ||
          !quote ||
          (!pending &&
            (invalid ||
              !Object.keys(selected).length ||
              !reason.trim() ||
              !charge))
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
              This rejection is unconfirmed. Retry the same request before
              recording another.
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
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                {line.item_name}
                <span className="block text-xs text-on-surface-variant">
                  Up to {line.max_qty} {line.uom} prepared and not already
                  rejected or replaced
                </span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={line.max_qty}
                step="any"
                aria-label={`${line.item_name} rejected quantity`}
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
            Charge decision
            <select
              aria-label="Charge decision"
              className="mt-1 min-h-10 w-full rounded-md border border-outline-variant bg-surface px-2"
              value={pending?.command.charge || charge}
              disabled={busy || Boolean(pending)}
              onChange={(event) =>
                setCharge(event.target.value as RejectionCommand["charge"])
              }
            >
              <option value="">Choose a decision</option>
              <option value="Keep charge">Keep the charge</option>
              <option value="Remove charge">Remove the charge</option>
            </select>
          </label>
          <p className="text-xs text-on-surface-variant">
            Removing the charge applies an approved discount, including
            proportional add-ons. Prepared quantities stay on the bill so their
            stock is consumed once. No waste journal is posted by this action.
          </p>
          <label className="block text-sm">
            Reason
            <textarea
              aria-label="Rejection reason"
              maxLength={500}
              className="mt-1 w-full rounded-md border border-outline-variant bg-surface p-2"
              value={pending?.command.reason || reason}
              disabled={busy || Boolean(pending)}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}
