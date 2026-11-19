import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { navigateToPosPage } from "../../../lib/stores/navigationStore";
import { ManagerPinDialog } from "../../pos/components/ManagerPinDialog";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { cancelKioskOrder, vunaMethods } from "../../../services/vunaApi";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { RestaurantSessionDTO } from "../types";
import { ClearTableButton } from "./ClearTableButton";
import { SessionBill } from "./SessionBill";

// A kiosk order on the session screen. While it awaits payment a cashier takes the
// payment with Confirm payment (the session bill) here, or cancels the order. Once
// paid, its table stays taken until staff clear it.
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
  const cancelCall = useFrappePostCall(vunaMethods.cancelKioskOrder);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const [dialog, setDialog] = useState<"cancel" | "pin" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const awaiting = session.kiosk_status === "Awaiting Payment";
  const paid = session.kiosk_status === "Paid";
  const heldTables = session.tables.filter((row) => !row.released_at);
  const canConfirm = Boolean(bootstrap.data?.can_take_payment);
  const canManage = Boolean(bootstrap.data?.can_manage_restaurant);
  const canCancel = canConfirm || canManage;
  const needsPin = Boolean(bootstrap.data?.restaurant?.require_manager_pin_order_cancel) && !canManage;
  const label = `Kiosk order ${session.order_number ?? ""}`.trim();

  const cancel = async (token?: string) => {
    if (running.current || !posProfile) return;
    running.current = true;
    setBusy(true);
    try {
      await cancelKioskOrder(cancelCall.call, {
        session: session.name,
        reason: reason.trim(),
        pos_profile: posProfile,
        manager_pin_token: token,
      });
      showToast({ type: "info", message: `${label} cancelled. Its table is free again.` });
      setDialog(null);
      changed();
      navigateToPosPage("Orders");
    } catch (error) {
      setDialog("cancel");
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "The kiosk order could not be cancelled. You can retry safely.",
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
          {awaiting ? "Awaiting payment" : paid ? "Paid" : "Sent to kitchen"}
        </span>
      </p>
      {awaiting ? (
        <>
          <p className="mt-1 text-on-surface-variant">
            {canConfirm
              ? "Confirm payment takes the payment, sends the order to the kitchen and prints the receipt."
              : "A cashier takes the payment. Nothing goes to the kitchen until then."}
          </p>
          {canConfirm || canCancel ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {canConfirm && posProfile ? (
                <SessionBill session={session} posProfile={posProfile} unsent={false} onChanged={onChanged} primary />
              ) : null}
              {canCancel ? (
                <Button size="sm" variant="ghost" className="text-error" disabled={busy} onClick={() => setDialog("cancel")}>
                  Cancel order
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {paid && heldTables.length ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-on-surface-variant">
            Paid. The table stays taken until the guests leave.
          </p>
          <ClearTableButton
            session={session.name}
            tableLabels={heldTables.map((row) => row.table_label).join(", ")}
            onCleared={onChanged}
          />
        </div>
      ) : null}
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
          else void cancel();
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
        onApproved={(token) => void cancel(token)}
      />
    </div>
  );
}
