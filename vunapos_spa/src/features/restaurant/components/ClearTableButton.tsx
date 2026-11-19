import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { clearTable, vunaMethods } from "../../../services/vunaApi";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { canClearTables } from "../restaurantRoles";
import { useOrderDraftStore } from "../stores/orderDraftStore";

// Frees the table of a paid kiosk order once its guests have left.
export function ClearTableButton({
  session,
  tableLabels,
  size = "sm",
  onCleared,
}: {
  session: string;
  tableLabels: string;
  size?: "sm" | "md";
  onCleared?: () => void;
}) {
  const bootstrap = useBootstrapData();
  const call = useFrappePostCall(vunaMethods.clearTable);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const changed = useOrderDraftStore((state) => state.markOrdersChanged);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  if (!canClearTables(bootstrap.data?.restaurant_roles, bootstrap.data?.can_manage_restaurant)) return null;

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await clearTable(call.call, session);
      showToast({ type: "info", message: `Table ${tableLabels} is free again.` });
      setOpen(false);
      changed();
      onCleared?.();
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "The table could not be cleared. You can retry safely.",
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        variant="secondary"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        Clear table
      </Button>
      <ConfirmDialog
        isOpen={open}
        title={`Clear table ${tableLabels}?`}
        description="The order is paid. Clear the table once the guests have left so it can take new guests."
        confirmLabel="Clear table"
        cancelLabel="Not yet"
        loading={busy}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onConfirm={() => void run()}
      />
    </>
  );
}
