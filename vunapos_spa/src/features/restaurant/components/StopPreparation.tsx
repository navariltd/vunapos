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
  readStop,
  saveStop,
  clearStop,
  type SavedStop,
  type StopQuote,
  type StopCommand,
} from "../stopCommand";

export function StopPreparation({
  ticket,
  allowed,
  onChanged,
}: {
  ticket: string;
  allowed: boolean;
  onChanged: () => void;
}) {
  const preview = useFrappePostCall(vunaMethods.previewPreparationStop);
  const stop = useFrappePostCall(vunaMethods.stopPreparation);
  const scope = useOrderDraftStore((s) => s.scope);
  const changed = useOrderDraftStore((s) => s.markOrdersChanged);
  const toast = useUiFeedbackStore((s) => s.showToast);
  const [saved] = useState(() => {
    try {
      return { pending: readStop(scope, ticket), error: "" };
    } catch (cause) {
      return { pending: null, error: (cause as Error).message };
    }
  });
  const [pending, setPending] = useState<SavedStop | null>(saved.pending);
  const [quote, setQuote] = useState<StopQuote | null>(
    saved.pending?.quote || null
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [used, setUsed] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState<StopCommand["charge"] | "">("");
  const [error, setError] = useState(saved.error);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const selected = pending?.command.line_ids || chosen;
  const materials =
    quote?.lines
      .filter((line) => selected.includes(line.line_id))
      .flatMap((line) => line.materials) || [];
  const decision = pending?.command.charge || charge;
  const incomplete = materials.some(
    (part) =>
      !used[part.id]?.trim() ||
      !Number.isFinite(Number(used[part.id])) ||
      Number(used[part.id]) < 0 ||
      Number(used[part.id]) > part.max_qty
  );
  const missingAccount =
    !quote?.waste_account &&
    materials.some((part) => Number(used[part.id]) > 0);
  const load = async () => {
    setOpen(true);
    if (pending || saved.error) return;
    setBusy(true);
    setError("");
    setQuote(null);
    setChosen([]);
    setUsed({});
    try {
      setQuote(unwrapVunaResponse<StopQuote>(await preview.call({ ticket })));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not review preparation."
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (running.current || !quote || saved.error || (!pending && !charge))
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const command = readStop(scope, ticket) ||
        pending || {
          command: {
            ticket,
            line_ids: chosen,
            used: Object.fromEntries(
              materials.map((part) => [part.id, Number(used[part.id])])
            ),
            fingerprint: quote.fingerprint,
            reason: reason.trim(),
            charge: charge as StopCommand["charge"],
            request_key: newId(),
          },
          quote,
        };
      saveStop(scope, command);
      setPending(command);
      unwrapVunaResponse(await stop.call(command.command));
      clearStop(scope, ticket);
      setPending(null);
      setQuote(null);
      setOpen(false);
      setReason("");
      setCharge("");
      toast({
        type: "info",
        message:
          "Unfinished preparation stopped. Reviewed usage was recorded, unused allocations released or returned, and the order updated.",
      });
    } catch (cause) {
      if (
        cause instanceof VunaApiError &&
        cause.serverRejected &&
        !["IDEMPOTENCY_CONFLICT", "PermissionError"].includes(cause.code || "")
      ) {
        try {
          clearStop(scope, ticket);
          setPending(null);
        } catch {
          /* Keep uncertain recovery. */
        }
        if (cause.code === "STOP_REVIEW_CHANGED") setQuote(null);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "The result is unconfirmed. Retry the original stop request safely."
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
        {pending ? "Review preparation stop" : "Stop preparation"}
      </Button>
      <ConfirmDialog
        isOpen={open}
        title="Stop unfinished preparation"
        description="Stop the entire unfinished balance of the selected dishes. Ready and served food stays on the order. This closes their Work Orders without making finished food or reversing earlier stock entries."
        confirmLabel={
          pending ? "Retry original stop" : "Approve and stop preparation"
        }
        loading={busy}
        confirmDisabled={
          busy ||
          Boolean(saved.error) ||
          !quote ||
          (!pending &&
            (!chosen.length ||
              incomplete ||
              !reason.trim() ||
              !decision ||
              (decision === "Keep charge" && !quote.charge_item) ||
              missingAccount))
        }
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onConfirm={() => void submit()}
      >
        <div className="max-h-[50dvh] space-y-4 overflow-y-auto overscroll-contain pr-1 text-sm">
          {error ? (
            <p role="alert" className="text-error">
              {error}
            </p>
          ) : null}
          {pending ? (
            <p>
              This stop is unconfirmed. Retry the original reviewed request
              before making another change.
            </p>
          ) : null}
          {!quote && !busy ? (
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              Review latest preparation
            </Button>
          ) : null}
          {quote && !quote.lines.length ? (
            <p>
              No unfinished cooking remains. Use item cancellation for dishes
              that have not started, or rejection for prepared food.
            </p>
          ) : null}
          {quote?.lines.map((line) => (
            <label
              key={line.line_id}
              className="flex items-start gap-3 rounded-md border border-outline-variant p-3"
            >
              <input
                type="checkbox"
                checked={selected.includes(line.line_id)}
                disabled={busy || Boolean(pending)}
                onChange={(event) =>
                  setChosen(
                    event.target.checked
                      ? [...chosen, line.line_id]
                      : chosen.filter((id) => id !== line.line_id)
                  )
                }
                className="mt-1 size-4"
              />
              <span>
                <span className="font-medium">{line.item_name}</span>
                <span className="block text-xs text-on-surface-variant">
                  Stop {line.qty} {line.uom} · keep {line.ready_qty} already
                  ready/served
                  {line.recorded_consumption?.length ? (
                    <span className="block">
                      Already issued (includes finished portions):{" "}
                      {line.recorded_consumption
                        .map(
                          (part) => `${part.qty} ${part.uom} ${part.item_code}`
                        )
                        .join(", ")}
                    </span>
                  ) : null}
                </span>
              </span>
            </label>
          ))}
          {materials.length ? (
            <section className="space-y-3">
              <h3 className="font-medium">Review ingredients not yet issued</h3>
              <p className="text-xs text-on-surface-variant">
                Enter additional quantities used or spoiled. Do not re-enter
                earlier stock consumption. Zero means unused. Unused WIP is
                returned to its original store; unused store allocations are
                released.
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || Boolean(pending)}
                onClick={() =>
                  setUsed({
                    ...used,
                    ...Object.fromEntries(
                      materials.map((part) => [part.id, "0"])
                    ),
                  })
                }
              >
                Mark remaining ingredients unused
              </Button>
              {materials.map((part) => (
                <label
                  key={part.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span>
                    {part.item_name}
                    <span className="block text-xs text-on-surface-variant">
                      {part.warehouse} · {part.max_qty} {part.uom} remaining (
                      {part.kind})
                    </span>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={part.max_qty}
                    step="any"
                    aria-label={`${part.item_name} additional used quantity ${part.id}`}
                    placeholder="Used"
                    className="min-h-10 w-24 shrink-0 rounded-md border border-outline-variant bg-surface px-2"
                    value={
                      pending
                        ? pending.command.used[part.id]
                        : used[part.id] ?? ""
                    }
                    disabled={busy || Boolean(pending)}
                    onChange={(event) =>
                      setUsed({ ...used, [part.id]: event.target.value })
                    }
                  />
                </label>
              ))}
            </section>
          ) : null}
          {missingAccount && !pending ? (
            <p role="alert" className="text-error">
              Set Waste Expense Account on the POS Profile to record used
              ingredients.
            </p>
          ) : null}
          <label className="block">
            Charge decision
            <select
              aria-label="Stop charge decision"
              className="mt-1 min-h-10 w-full rounded-md border border-outline-variant bg-surface px-2"
              value={decision}
              disabled={busy || Boolean(pending)}
              onChange={(event) =>
                setCharge(event.target.value as StopCommand["charge"])
              }
            >
              <option value="">Choose a decision</option>
              <option value="Remove charge">
                Remove the unfinished food's charge
              </option>
              <option value="Keep charge">Keep as a cancellation charge</option>
            </select>
          </label>
          {decision === "Keep charge" ? (
            <p
              className={
                quote?.charge_item
                  ? "text-xs text-on-surface-variant"
                  : "text-error"
              }
            >
              {quote?.charge_item
                ? `The charge uses ${quote.charge_item}, including proportional add-ons. Its configured taxes apply; review the updated bill before taking payment.`
                : "Set an enabled non-stock Cancellation Charge Item on the POS Profile first."}
            </p>
          ) : null}
          <label className="block">
            Reason
            <textarea
              aria-label="Stop preparation reason"
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
