import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";

// Retail renders toasts inside POSHomePage, which Restaurant mode does not
// mount. Same store and styling, limited to the toast types restaurant uses.
export function RestaurantToast() {
  const toast = useUiFeedbackStore((s) => s.toast);
  const toastClosing = useUiFeedbackStore((s) => s.toastClosing);
  const animation = toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in";

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
