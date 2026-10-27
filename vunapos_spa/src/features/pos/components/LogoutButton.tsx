import { useState } from "react";
import { LogOut } from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";

import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { navigateToPosPage } from "../../../lib/stores/navigationStore";
import { useBootstrapData } from "../hooks/useBootstrapData";
import { usePosSessionStatus } from "../hooks/usePosSessionStatus";
import { shiftCheckNeeded, shouldConfirmLogout } from "../logoutPrompt";
import { useUiFeedbackStore } from "../stores/uiFeedbackStore";

const LOGIN_URL = "/login?redirect-to=/vunapos";

// Frappe only accepts POST for logout; a plain link to /?cmd=web_logout is a GET
// and is refused with 403 "Not permitted".
export function LogoutButton() {
  const { logout } = useFrappeAuth();
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const bootstrap = useBootstrapData();
  const posMode = bootstrap.data?.pos_mode;
  const canTakePayment = bootstrap.data?.can_take_payment;
  // Shares its request with PosOpeningGate; skipped for users who hold no shifts.
  const { session } = usePosSessionStatus(
    shiftCheckNeeded({ posMode, canTakePayment }) ? bootstrap.data?.pos_profile : undefined,
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      window.location.assign(LOGIN_URL);
    } catch {
      setLoggingOut(false);
      setConfirmOpen(false);
      showToast({ type: "error", message: "Could not log out. Check the connection and try again." });
    }
  }

  function requestLogout() {
    if (shouldConfirmLogout({ posMode, canTakePayment, shiftOpen: Boolean(session?.ready) })) {
      setConfirmOpen(true);
      return;
    }
    void handleLogout();
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-error px-3 text-sm font-medium text-on-error hover:bg-error-container hover:text-on-error-container disabled:opacity-60"
        disabled={loggingOut}
        onClick={requestLogout}
      >
        <LogOut className="size-4" />
        {loggingOut ? "Logging out..." : "Logout"}
      </button>
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Log out with your shift open?"
        description="Your shift is still open. It stays open until you close it. Log out anyway?"
        confirmLabel="Log out"
        danger
        hideCancel
        loading={loggingOut}
        secondaryLabel="Close shift instead"
        onSecondary={() => {
          setConfirmOpen(false);
          navigateToPosPage("Close Shift");
        }}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleLogout()}
      />
    </>
  );
}
