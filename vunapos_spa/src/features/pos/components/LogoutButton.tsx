import { useState } from "react";
import { LogOut } from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";

import { useUiFeedbackStore } from "../stores/uiFeedbackStore";

const LOGIN_URL = "/login?redirect-to=/vunapos";

// Frappe only accepts POST for logout; a plain link to /?cmd=web_logout is a GET
// and is refused with 403 "Not permitted".
export function LogoutButton() {
  const { logout } = useFrappeAuth();
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      window.location.assign(LOGIN_URL);
    } catch {
      setLoggingOut(false);
      showToast({ type: "error", message: "Could not log out. Check the connection and try again." });
    }
  }

  return (
    <button
      type="button"
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-error px-3 text-sm font-medium text-on-error hover:bg-error-container hover:text-on-error-container disabled:opacity-60"
      disabled={loggingOut}
      onClick={() => void handleLogout()}
    >
      <LogOut className="size-4" />
      {loggingOut ? "Logging out..." : "Logout"}
    </button>
  );
}
