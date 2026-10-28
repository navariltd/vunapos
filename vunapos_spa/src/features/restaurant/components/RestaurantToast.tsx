import { useEffect } from "react";

import { navigateToOrder } from "../../../lib/stores/navigationStore";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useOrderDraftStore } from "../stores/orderDraftStore";

const SENT_NOTICE_MS = 6000;

// Retail renders toasts inside POSHomePage, which Restaurant mode does not
// mount. Same store and styling, limited to the toast types restaurant uses,
// plus the "Order … sent" notice with a link back to that order.
export function RestaurantToast() {
  const toast = useUiFeedbackStore((s) => s.toast);
  const toastClosing = useUiFeedbackStore((s) => s.toastClosing);
  const sentNotice = useOrderDraftStore((s) => s.sentNotice);
  const setSentNotice = useOrderDraftStore((s) => s.setSentNotice);
  const animation = toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in";

  useEffect(() => {
    if (!sentNotice) return undefined;
    const timer = setTimeout(() => setSentNotice(null), SENT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [sentNotice, setSentNotice]);

  if (sentNotice && !toast) {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-4 z-[60] mx-auto flex w-[calc(100%-2rem)] max-w-sm items-center gap-3 rounded-md border border-primary bg-primary-container px-4 py-2 text-sm text-on-primary-container shadow-md animate-toast-drop-in"
      >
        <span className="min-w-0 flex-1">
          Order {sentNotice.order} sent · {sentNotice.label}
        </span>
        <button
          type="button"
          className="h-9 shrink-0 rounded-md px-2 font-semibold underline"
          onClick={() => {
            setSentNotice(null);
            navigateToOrder(sentNotice.order);
          }}
        >
          Open
        </button>
      </div>
    );
  }

  if (toast?.type === "info") {
    return (
      <div
        role="status"
        className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-primary bg-primary-container px-4 py-3 text-sm text-on-primary-container shadow-md ${animation}`}
      >
        {toast.message}
      </div>
    );
  }
  if (toast?.type === "error") {
    return (
      <div
        role="alert"
        className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container shadow-md ${animation}`}
      >
        {toast.message}
      </div>
    );
  }
  return null;
}
