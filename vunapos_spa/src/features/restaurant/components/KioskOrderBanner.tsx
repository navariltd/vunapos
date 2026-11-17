import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { navigateToPosPage } from "../../../lib/stores/navigationStore";
import { ManagerPinDialog } from "../../pos/components/ManagerPinDialog";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { cancelKioskOrder, confirmKioskPayment, vunaMethods } from "../../../services/vunaApi";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { RestaurantSessionDTO } from "../types";

// A kiosk order on the session screen. While it awaits payment a cashier confirms the
// customer paid at the counter, which sends it to the kitchen, or cancels it.
export function KioskOrderBanner({
  session,
  posProfile,
  onChanged,
}: {
  session: RestaurantSessionDTO;
  posProfile?: string;
  onChanged: () => void;
}) {
  const bootstrap = useBootstrapData();
  const confirmCall = useFrappePostCall(vunaMethods.confirmKioskPayment);
  const cancelCall = useFrappePostCall(vunaMethods.cancelKioskOrder);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const [dialog, setDialog] = useState<"confirm" | "cancel" | "pin" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const awaiting = session.kiosk_status === "Awaiting Payment";
  const canConfirm = Boolean(bootstrap.data?.can_take_payment);
  const canManage = Boolean(bootstrap.data?.can_manage_restaurant);
  const canCancel = canConfirm || canManage;
  const needsPin = Boolean(bootstrap.data?.restaurant?.require_manager_pin_order_cancel) && !canManage;
  const label = `Kiosk order ${session.order_number ?? ""}`.trim();

  const run = async (action: "confirm" | "cancel", token?: string) => {
    if (running.current || !posProfile) return;
    running.current = true;
    setBusy(true);
    try {
      if (action === "confirm") {
        await confirmKioskPayment(confirmCall.call, { session: session.name, pos_profile: posProfile });
        showToast({ type: "info", message: `${label} sent to the kitchen.` });
      } else {
        await cancelKioskOrder(cancelCall.call, {
          session: session.name,
          reason: reason.trim(),
          pos_profile: posProfile,
          manager_pin_token: token,
        });
        showToast({ type: "info", message: `${label} cancelled. Its table is free again.` });
      }
      setDialog(null);
      changed();
      if (action === "cancel") navigateToPosPage("Orders");
      else onChanged();
    } catch (error) {
      setDialog(action === "cancel" && dialog === "pin" ? "cancel" : dialog);
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "The kiosk order could not be updated. You can retry safely.",
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        awaiting ? "border-tertiary/40 bg-tertiary-container/30" : "border-outline-variant bg-surface-container-low"
      }`}
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold text-on-surface">
        {label}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            awaiting ? "bg-tertiary-container text-on-tertiary-container" : "bg-surface-container text-on-surface-variant"
          }`}
        >
          {awaiting ? "Awaiting payment" : "Sent to kitchen"}
        </span>
      </p>
      {awaiting ? (
        <>
          <p className="mt-1 text-on-surface-variant">
            Take payment at the counter, then confirm it. Nothing goes to the kitchen until you do.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canConfirm ? (
              <Button size="sm" disabled={busy} onClick={() => setDialog("confirm")}>
                Confirm payment
              </Button>
            ) : (
              <span className="text-xs text-on-surface-variant">A cashier confirms the payment.</span>
            )}
            {canCancel ? (
              <Button size="sm" variant="ghost" className="text-error" disabled={busy} onClick={() => setDialog("cancel")}>
                Cancel order
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      <ConfirmDialog
        isOpen={dialog === "confirm"}
        title={`Confirm payment for ${label.toLowerCase()}?`}
        description="Only confirm once the customer has paid. The order goes to the kitchen straight away; bill it through this session as usual."
        confirmLabel="Payment received"
        loading={busy}
        onCancel={() => {
          if (!busy) setDialog(null);
        }}
        onConfirm={() => void run("confirm")}
      />
      <ConfirmDialog
        isOpen={dialog === "cancel"}
        danger
        title={`Cancel ${label.toLowerCase()}?`}
        description="Use this when the customer never paid. Nothing was sent to the kitchen, and the table becomes free."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        confirmDisabled={!reason.trim() || busy}
        loading={busy}
        onCancel={() => {
          if (!busy) setDialog(null);
        }}
        onConfirm={() => {
          if (needsPin) setDialog("pin");
          else void run("cancel");
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
        isOpen={dialog === "pin"}
        posProfile={posProfile}
        action="order_cancel"
        onCancel={() => setDialog("cancel")}
        onApproved={(token) => void run("cancel", token)}
      />
    </div>
  );
}
