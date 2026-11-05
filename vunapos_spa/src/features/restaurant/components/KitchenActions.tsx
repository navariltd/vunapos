import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { ManagerPinDialog } from "../../pos/components/ManagerPinDialog";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import {
  cancelKitchenOrder,
  kitchenAction,
  vunaMethods,
} from "../../../services/vunaApi";
import { newId } from "../ids";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { KITCHEN_ACTION_LABELS } from "../kitchenStatus";
import type { KitchenAction, KitchenTicketDTO } from "../types";

export function KitchenActions({
  ticket,
  onChanged,
  showCancel = true,
}: {
  ticket: KitchenTicketDTO;
  onChanged: () => void;
  showCancel?: boolean;
}) {
  const actionCall = useFrappePostCall(vunaMethods.kitchenAction);
  const cancelCall = useFrappePostCall(vunaMethods.cancelKitchenOrder);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const keys = useRef(new Map<string, string>());
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const requestKey = (action: string) => {
    const key = `${ticket.name}:${action}`;
    if (!keys.current.has(key)) keys.current.set(key, newId());
    return keys.current.get(key)!;
  };
  const perform = async (
    action: KitchenAction | "Cancel Order",
    token?: string
  ) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (action === "Cancel Order")
        await cancelKitchenOrder(cancelCall.call, {
          ticket: ticket.name,
          request_key: requestKey(`${action}:${reason.trim()}`),
          expected_status: ticket.status,
          reason: reason.trim(),
          manager_pin_token: token,
        });
      else
        await kitchenAction(actionCall.call, {
          ticket: ticket.name,
          action,
          request_key: requestKey(action),
          expected_status: ticket.status,
        });
      setConfirm(false);
      setPinOpen(false);
      showToast({
        type: "info",
        message:
          action === "Cancel Order"
            ? "Placed order cancelled. Its table remains assigned until the session is closed."
            : `${ticket.name}: ${KITCHEN_ACTION_LABELS[action]} completed.`,
      });
    } catch (error) {
      showToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Kitchen action failed. You can retry safely.",
      });
    } finally {
      running.current = false;
      setBusy(false);
      changed();
      onChanged();
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(ticket.available_actions || []).map((action) => (
          <Button
            key={action}
            size="sm"
            disabled={busy}
            onClick={() => void perform(action)}
          >
            {busy ? "Updating…" : KITCHEN_ACTION_LABELS[action]}
          </Button>
        ))}
        {showCancel && ticket.can_cancel_order ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-error"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Cancel placed order
          </Button>
        ) : null}
      </div>
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
    </>
  );
}
