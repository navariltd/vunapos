import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { navigateToPosPage } from "../../../lib/stores/navigationStore";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { acceptQrOrder, rejectQrOrder, vunaMethods } from "../../../services/vunaApi";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { RestaurantSessionDTO } from "../types";

// A guest's QR order on the session screen. While it is pending, nothing has reached
// the kitchen: staff check the items and Accept (which sends them to the kitchen and
// makes them the waiter) or Reject (which deletes the order and frees the table).
export function QrOrderBanner({
  session,
  posProfile,
  onChanged,
}: {
  session: RestaurantSessionDTO;
  posProfile?: string;
  onChanged: () => void;
}) {
  const acceptCall = useFrappePostCall(vunaMethods.acceptQrOrder);
  const rejectCall = useFrappePostCall(vunaMethods.rejectQrOrder);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const pending = session.qr_status === "Pending";
  const table = session.tables.map((row) => row.table_label).join(", ");
  const lines = session.rounds.flatMap((round) => round.items);

  const run = async (action: "accept" | "reject") => {
    if (running.current || !posProfile) return;
    running.current = true;
    setBusy(true);
    try {
      if (action === "accept") {
        await acceptQrOrder(acceptCall.call, { session: session.name, pos_profile: posProfile });
        showToast({ type: "info", message: `QR order for table ${table} sent to the kitchen. You are its waiter.` });
        changed();
        onChanged();
      } else {
        await rejectQrOrder(rejectCall.call, { session: session.name, reason: reason.trim(), pos_profile: posProfile });
        showToast({ type: "info", message: `QR order rejected. Table ${table} is free again.` });
        setRejecting(false);
        changed();
        navigateToPosPage("Orders");
      }
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "The QR order could not be updated. You can retry safely.",
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        pending ? "border-status-qr bg-status-qr-container" : "border-outline-variant bg-surface-container-low"
      }`}
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold text-on-surface">
        {pending ? "New QR order" : "QR order"}
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
          {pending ? "Waiting for a waiter" : session.qr_status === "Accepted" ? "Accepted" : "Rejected"}
        </span>
      </p>
      {pending ? (
        <>
          <p className="mt-1 text-on-surface-variant">
            A guest at table {table} sent this order from their phone. Nothing goes to the kitchen until you accept it.
          </p>
          {lines.length ? (
            <ul className="mt-2 space-y-1" aria-label="Items in the QR order">
              {lines.map((line) => (
                <li key={line.line_id} className={line.parent_line_id ? "pl-5 text-on-surface-variant" : "text-on-surface"}>
                  {line.qty} × {line.item_name}
                  {line.modifiers?.length ? (
                    <span className="block text-xs text-on-surface-variant">
                      {line.modifiers.map((choice) => choice.label).join(" · ")}
                    </span>
                  ) : null}
                  {line.note ? <span className="block text-xs italic text-on-surface-variant">“{line.note}”</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !posProfile} onClick={() => void run("accept")}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" className="text-error" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        isOpen={rejecting}
        danger
        title="Reject this QR order?"
        description="The order is deleted and the table becomes free. The guest's phone shows that the order could not be accepted."
        confirmLabel="Reject order"
        cancelLabel="Keep order"
        confirmDisabled={!reason.trim() || busy}
        loading={busy}
        onCancel={() => {
          if (!busy) setRejecting(false);
        }}
        onConfirm={() => void run("reject")}
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
    </div>
  );
}
