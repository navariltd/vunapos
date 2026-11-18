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
  readRemake,
  saveRemake,
  clearRemake,
  type SavedRemake,
  type RemakeQuote,
  type RemakeCommand,
} from "../remakeCommand";

export function RemakeItems({
  ticket,
  allowed,
  onChanged,
}: {
  ticket: string;
  allowed: boolean;
  onChanged: () => void;
}) {
  const preview = useFrappePostCall(vunaMethods.previewRemake);
  const request = useFrappePostCall(vunaMethods.requestRemake);
  const scope = useOrderDraftStore((state) => state.scope);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const toast = useUiFeedbackStore((state) => state.showToast);
  const [saved] = useState(() => {
    try {
      return { pending: readRemake(scope, ticket), error: "" };
    } catch (error) {
      return { pending: null, error: (error as Error).message };
    }
  });
  const [pending, setPending] = useState<SavedRemake | null>(saved.pending);
  const [quote, setQuote] = useState<RemakeQuote | null>(
    saved.pending?.quote || null
  );
  const [values, setValues] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<
    RemakeCommand["disposition"] | ""
  >("");
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
      setQuote(unwrapVunaResponse<RemakeQuote>(await preview.call({ ticket })));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not review preparation quantities."
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
    if (running.current || !quote || saved.error || (!pending && !disposition))
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const command = readRemake(scope, ticket) ||
        pending || {
          command: {
            ticket,
            quantities: selected,
            reason: reason.trim(),
            disposition: disposition as RemakeCommand["disposition"],
            fingerprint: quote.fingerprint,
            request_key: newId(),
          },
          quote,
        };
      saveRemake(scope, command);
      setPending(command);
      unwrapVunaResponse(await request.call(command.command));
      clearRemake(scope, ticket);
      setPending(null);
      setQuote(null);
      setOpen(false);
      setReason("");
      setDisposition("");
      toast({
        type: "info",
        message:
          "Replacement sent to the kitchen. The ordered quantity and customer bill have not increased.",
      });
    } catch (caught) {
      if (
        caught instanceof VunaApiError &&
        caught.serverRejected &&
        caught.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        try {
          clearRemake(scope, ticket);
          setPending(null);
        } catch {
          /* Preserve uncertain recovery. */
        }
        if (caught.code === "REMAKE_REVIEW_CHANGED") setQuote(null);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The result is unconfirmed. Retry the original remake request safely."
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
        {pending ? "Review remake request" : "Remake items"}
      </Button>
      <ConfirmDialog
        isOpen={open}
        title="Remake prepared food"
        description="Prepare the same dish again with its original UOM, notes and add-ons, without adding another customer charge. For a different dish, review cancellation or rejection and place a new order. Food already cooked under the wrong recipe needs a separate stock review; a remake does not correct it."
        confirmLabel={
          pending ? "Retry original remake" : "Approve and send replacement"
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
              !disposition))
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
              This remake is unconfirmed. Retry the same request before sending
              another replacement.
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
                  replaced
                </span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={line.max_qty}
                step="any"
                aria-label={`${line.item_name} remake quantity`}
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
            What happens to the original food?
            <select
              value={pending?.command.disposition || disposition}
              disabled={busy || Boolean(pending)}
              onChange={(event) =>
                setDisposition(
                  event.target.value as RemakeCommand["disposition"]
                )
              }
              className="mt-1 block min-h-10 w-full rounded-md border border-outline-variant bg-surface px-2"
            >
              <option value="">Choose an action</option>
              <option value="Discard">Discard it</option>
              <option value="Keep for guest">Keep it for this guest</option>
            </select>
            <span className="mt-1 block text-xs text-on-surface-variant">
              Neither option returns food to saleable stock. The original charge
              remains.
            </span>
          </label>
          <label className="block text-sm">
            Remake reason
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
