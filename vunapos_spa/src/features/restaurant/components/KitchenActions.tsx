import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { ManagerPinDialog } from "../../pos/components/ManagerPinDialog";
import { CancelOrderItems } from "./CancelOrderItems";
import { RecordWaste } from "./RecordWaste";
import { RemakeItems } from "./RemakeItems";
import { RejectPreparedItems } from "./RejectPreparedItems";
import { StopPreparation } from "./StopPreparation";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import {
  cancelKitchenOrder,
  kitchenAction,
  VunaApiError,
  vunaMethods,
} from "../../../services/vunaApi";
import { newId } from "../ids";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { KITCHEN_ACTION_LABELS } from "../kitchenStatus";
import type { KitchenAction, KitchenTicketDTO } from "../types";
import {
  clearKitchenCommand,
  kitchenLines,
  positiveKitchenQuantities,
  readKitchenCommand,
  saveKitchenCommand,
  type KitchenCommand,
} from "../kitchenCommand";

const LINE_LABELS = {
  Ready: "Ready",
  Serve: "Served",
};
const ALL_LABELS = {
  Accept: "Accept ticket",
  Start: "Start preparing",
  Ready: "Ready all",
  Serve: "Serve all",
};
type RoutineAction = keyof typeof ALL_LABELS;
type QuantityAction = keyof typeof LINE_LABELS;
const KitchenContext = createContext<{
  ticket: KitchenTicketDTO;
  disabled: boolean;
  perform: (
    action: KitchenAction,
    quantities: Record<string, number>,
    snapshot: KitchenTicketDTO
  ) => Promise<boolean>;
} | null>(null);

function LineAction({
  line,
  action,
}: {
  line: KitchenTicketDTO["items"][number];
  action: QuantityAction;
}) {
  const context = useContext(KitchenContext)!;
  const maximum = line.available_quantities?.[action] || 0;
  const [edit, setEdit] = useState<{
    value: string;
    snapshot: KitchenTicketDTO;
  } | null>(null);
  const value = edit?.value ?? String(maximum);
  const qty = Number(value);
  const stale = Boolean(
    edit && edit.snapshot.modified !== context.ticket.modified
  );
  const invalid = !Number.isFinite(qty) || qty <= 0 || qty > maximum;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (stale || invalid || context.disabled) return;
        if (
          await context.perform(
            action,
            { [line.line_id]: qty },
            edit?.snapshot || context.ticket
          )
        )
          setEdit(null);
      }}
    >
      <label className="flex items-center gap-1 text-xs text-on-surface-variant">
        <span className="sr-only">
          {line.item_name}: {LINE_LABELS[action]} quantity
        </span>
        <input
          type="number"
          min="0.000001"
          max={maximum}
          step="any"
          inputMode="decimal"
          className="min-h-10 w-20 rounded-md border border-outline-variant bg-surface px-2 text-sm text-on-surface"
          value={value}
          aria-invalid={Boolean(edit && invalid)}
          disabled={context.disabled || stale}
          onChange={(event) =>
            setEdit({
              value: event.target.value,
              snapshot: edit?.snapshot || context.ticket,
            })
          }
        />
        <span>
          /{" "}
          {new Intl.NumberFormat(undefined, {
            maximumFractionDigits: 6,
          }).format(maximum)}{" "}
          {line.uom}
        </span>
      </label>
      <Button
        type="submit"
        size="sm"
        disabled={context.disabled || invalid || stale}
        aria-label={`${LINE_LABELS[action]} ${line.item_name}`}
      >
        {LINE_LABELS[action]}
      </Button>
      {edit && invalid && !stale ? (
        <span className="text-xs text-error">
          Enter more than 0, up to {maximum} {line.uom}.
        </span>
      ) : null}
      {stale ? (
        <button
          type="button"
          className="min-h-10 cursor-pointer text-xs underline"
          onClick={() => setEdit(null)}
        >
          Ticket changed — use latest quantity
        </button>
      ) : null}
    </form>
  );
}

export function KitchenLineActions({
  line,
}: {
  line: KitchenTicketDTO["items"][number];
}) {
  const context = useContext(KitchenContext);
  if (
    !context ||
    line.parent_line_id ||
    !context.ticket.modified ||
    context.ticket.status === "Cancelled"
  )
    return null;
  const actions = (context.ticket.available_actions || []).filter(
    (action): action is QuantityAction =>
      (action === "Ready" || action === "Serve") &&
      Number(line.available_quantities?.[action]) > 0
  );
  return actions.length ? (
    <div className="mt-3 flex flex-col gap-2">
      {actions.map((action) => (
        <LineAction key={action} line={line} action={action} />
      ))}
    </div>
  ) : null;
}

export function KitchenActions({
  ticket,
  onChanged,
  showCancel = true,
  children,
}: {
  ticket: KitchenTicketDTO;
  onChanged: () => void;
  showCancel?: boolean;
  children?: ReactNode;
}) {
  const actionCall = useFrappePostCall(vunaMethods.kitchenAction);
  const cancelCall = useFrappePostCall(vunaMethods.cancelKitchenOrder);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const scope = useOrderDraftStore((state) => state.scope);
  const [saved] = useState(() => {
    try {
      return {
        command: readKitchenCommand(scope, ticket.name),
        error: null as string | null,
      };
    } catch {
      return {
        command: null,
        error:
          "The saved kitchen action could not be read. Ask a manager to review this ticket before clearing its browser storage.",
      };
    }
  });
  const [pending, setPending] = useState<KitchenCommand | null>(saved.command);
  const [partial, setPartial] = useState<{
    snapshot: KitchenTicketDTO;
    action: KitchenAction;
    values: Record<string, number>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const keys = useRef(new Map<string, string>());
  const [confirm, setConfirm] = useState(false);
  const [cancelRemakeOpen, setCancelRemakeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const ticketActions = (ticket.available_actions || []).filter(
    (action): action is RoutineAction =>
      action !== "Undo Serve" &&
      action !== "Cancel Remake" &&
      // Finish acknowledging pre-existing partially accepted tickets first.
      !(action === "Start" && ticket.available_actions?.includes("Accept"))
  );
  const requestKey = (action: string) => {
    const key = `${ticket.name}:${action}`;
    if (!keys.current.has(key)) keys.current.set(key, newId());
    return keys.current.get(key)!;
  };
  const perform = async (
    action: KitchenAction | "Cancel Order",
    token?: string,
    quantities?: Record<string, number>,
    snapshot: KitchenTicketDTO = ticket,
    correction?: string
  ) => {
    if (
      running.current ||
      saved.error ||
      (action === "Cancel Order" && pending)
    )
      return false;
    running.current = true;
    setBusy(true);
    let completedAction = action;
    try {
      if (action === "Cancel Order")
        await cancelKitchenOrder(cancelCall.call, {
          ticket: ticket.name,
          request_key: requestKey(`${action}:${reason.trim()}`),
          expected_status: ticket.status,
          reason: reason.trim(),
          manager_pin_token: token,
        });
      else {
        const command = readKitchenCommand(scope, ticket.name) ||
          pending || {
            ticket: ticket.name,
            action,
            request_key: newId(),
            expected_status: snapshot.status,
            expected_modified: snapshot.modified,
            ...(quantities ? { quantities } : {}),
            ...(action === "Undo Serve" || action === "Cancel Remake"
              ? { reason: correction?.trim() }
              : {}),
          };
        saveKitchenCommand(scope, command);
        completedAction = command.action;
        setPending(command);
        await kitchenAction(actionCall.call, command);
        clearKitchenCommand(scope, ticket.name);
        setPending(null);
        setPartial(null);
      }
      setConfirm(false);
      setCancelRemakeOpen(false);
      setPinOpen(false);
      showToast({
        type: "info",
        message:
          action === "Cancel Order"
            ? "Placed order cancelled. Its table remains assigned until the session is closed."
            : `${ticket.name}: ${
                KITCHEN_ACTION_LABELS[completedAction as KitchenAction]
              } completed.`,
      });
      return true;
    } catch (error) {
      if (
        action !== "Cancel Order" &&
        error instanceof VunaApiError &&
        error.serverRejected &&
        error.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        try {
          clearKitchenCommand(scope, ticket.name);
          setPending(null);
        } catch {
          /* Keep recovery available if storage cannot be cleared. */
        }
        if (error.code === "KITCHEN_STALE_STATE") setPartial(null);
      }
      showToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Kitchen action failed. You can retry safely.",
      });
      return false;
    } finally {
      running.current = false;
      setBusy(false);
      changed();
      onChanged();
    }
  };
  const chooseQuantities = (action: KitchenAction) => {
    setCorrectionReason("");
    setPartial({
      snapshot: ticket,
      action,
      values: Object.fromEntries(
        kitchenLines(ticket, action).map((line) => [
          line.line_id,
          line.available_quantities?.[action] || 0,
        ])
      ),
    });
  };
  return (
    <KitchenContext.Provider
      value={{
        ticket,
        disabled: busy || Boolean(pending) || Boolean(saved.error),
        perform: (action, quantities, snapshot) =>
          perform(action, undefined, quantities, snapshot),
      }}
    >
      {children}
      {showCancel ? (
        <div className="mt-2">
          <CancelOrderItems
            order={ticket.sales_order}
            allowed={Boolean(ticket.can_cancel_order)}
            onChanged={onChanged}
          />
          <RecordWaste
            key={`${scope}:${ticket.name}`}
            ticket={ticket.name}
            allowed={Boolean(ticket.can_record_waste)}
            onChanged={onChanged}
          />
          <RemakeItems
            key={`remake:${scope}:${ticket.name}`}
            ticket={ticket.name}
            allowed={Boolean(ticket.can_remake)}
            onChanged={onChanged}
          />
          <RejectPreparedItems
            key={`rejection:${scope}:${ticket.name}`}
            ticket={ticket.name}
            allowed={Boolean(ticket.can_reject)}
            onChanged={onChanged}
          />
          <StopPreparation
            key={`stop:${scope}:${ticket.name}`}
            ticket={ticket.name}
            allowed={Boolean(ticket.can_stop_preparation)}
            onChanged={onChanged}
          />
        </div>
      ) : null}
      {saved.error ? (
        <p role="alert" className="mb-2 text-sm text-error">
          {saved.error}
        </p>
      ) : null}
      {pending ? (
        <div className="m-3 space-y-2 text-sm">
          <p>
            This action has not been confirmed. Retry the original action before
            updating other quantities.
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void perform(pending.action)}
          >
            {busy
              ? "Checking…"
              : `Retry ${KITCHEN_ACTION_LABELS[pending.action].toLowerCase()}`}
          </Button>
        </div>
      ) : null}
      {ticketActions.length > 0 ||
      (showCancel &&
        (ticket.available_actions?.includes("Undo Serve") ||
          ticket.can_cancel_order)) ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-outline-variant px-3 py-2">
          {ticketActions.map((action) => (
            <Button
              key={action}
              size="sm"
              disabled={busy || Boolean(pending) || Boolean(saved.error)}
              variant={action === "Accept" ? "primary" : "ghost"}
              onClick={() => void perform(action)}
            >
              {busy ? "Updating…" : ALL_LABELS[action]}
            </Button>
          ))}
          {showCancel && ticket.available_actions?.includes("Undo Serve") ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || Boolean(pending) || Boolean(saved.error)}
              onClick={() => chooseQuantities("Undo Serve")}
            >
              Correct served quantity
            </Button>
          ) : null}
          {showCancel && ticket.can_cancel_order ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-error"
              disabled={busy || Boolean(pending) || Boolean(saved.error)}
              onClick={() => setConfirm(true)}
            >
              Cancel placed order
            </Button>
          ) : null}
          {showCancel && ticket.can_cancel_remake ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-error"
              disabled={busy || Boolean(pending) || Boolean(saved.error)}
              onClick={() => {
                setReason("");
                setCancelRemakeOpen(true);
              }}
            >
              Cancel replacement
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        isOpen={cancelRemakeOpen}
        danger
        title="Cancel replacement"
        description="Release ingredients only if this replacement has no stock movements. The original charge and its recorded food disposition stay unchanged; the original is not returned to the service queue."
        confirmLabel="Cancel replacement"
        loading={busy}
        confirmDisabled={busy || !reason.trim()}
        onCancel={() => {
          if (!busy) setCancelRemakeOpen(false);
        }}
        onConfirm={() =>
          void perform("Cancel Remake", undefined, undefined, ticket, reason)
        }
      >
        <label className="block text-sm">
          Cancellation reason
          <textarea
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 block min-h-20 w-full rounded-md border border-outline-variant bg-surface p-2"
          />
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={Boolean(partial)}
        title="Correct served quantity"
        description="Correct meals marked served by mistake. Only return untouched meals to ready to serve; consumed food needs manager review. This does not move charges to another table, manufacture food, or reverse stock, invoices or payments."
        confirmLabel={
          pending
            ? "Retry original action"
            : partial
            ? KITCHEN_ACTION_LABELS[partial.action]
            : "Update"
        }
        confirmDisabled={
          busy ||
          (!pending &&
            partial?.action === "Undo Serve" &&
            !correctionReason.trim()) ||
          (!pending &&
            !Object.keys(positiveKitchenQuantities(partial?.values || {}))
              .length)
        }
        loading={busy}
        onCancel={() => {
          if (!busy) setPartial(null);
        }}
        onConfirm={() => {
          if (partial)
            void perform(
              partial.action,
              undefined,
              positiveKitchenQuantities(partial.values),
              partial.snapshot,
              correctionReason
            );
        }}
      >
        {partial ? (
          <div className="space-y-3">
            {kitchenLines(partial.snapshot, partial.action).map((line) => (
              <label
                key={line.line_id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>
                  {line.item_name}
                  <span className="block text-xs text-on-surface-variant">
                    Up to{" "}
                    {new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 6,
                    }).format(
                      line.available_quantities?.[partial.action] || 0
                    )}{" "}
                    {line.uom}
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={line.available_quantities?.[partial.action]}
                  step="any"
                  aria-label={`${line.item_name} quantity`}
                  disabled={busy || Boolean(pending)}
                  className="w-28 rounded-md border border-outline-variant bg-surface p-2"
                  value={partial.values[line.line_id] ?? 0}
                  onChange={(event) =>
                    setPartial({
                      ...partial,
                      values: {
                        ...partial.values,
                        [line.line_id]: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
            <p className="text-xs text-on-surface-variant">
              Set a quantity to 0 to leave that dish unchanged.
            </p>
            {partial.action === "Undo Serve" ? (
              <label className="block text-sm">
                Correction reason
                <textarea
                  maxLength={500}
                  className="mt-1 w-full rounded-md border border-outline-variant bg-surface p-2"
                  value={correctionReason}
                  disabled={busy || Boolean(pending)}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                />
                <span className="text-xs text-on-surface-variant">
                  Returns the selected quantity to ready to serve. No food is
                  manufactured and no stock, invoice or payment is reversed.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirm && !pinOpen}
        danger
        title="Cancel the whole placed order?"
        description={`This cancels ${ticket.sales_order} across all kitchen stations, not just this ticket. Production or WIP movements must be explicitly reversed in ERPNext first. The session/table stays open.`}
        confirmLabel="Cancel placed order"
        confirmDisabled={!reason.trim() || busy}
        loading={busy}
        onCancel={() => {
          if (!busy) setConfirm(false);
        }}
        onConfirm={() => {
          if (ticket.requires_cancel_pin) setPinOpen(true);
          else void perform("Cancel Order");
        }}
      >
        <label className="block text-sm">
          Reason
          <textarea
            className="mt-2 w-full rounded-md border border-outline-variant bg-surface p-2"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          />
        </label>
      </ConfirmDialog>
      <ManagerPinDialog
        isOpen={pinOpen}
        action="order_cancel"
        posProfile={ticket.pos_profile}
        onCancel={() => setPinOpen(false)}
        onApproved={(token) => {
          setPinOpen(false);
          void perform("Cancel Order", token);
        }}
      />
    </KitchenContext.Provider>
  );
}
