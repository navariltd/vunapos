import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { VunaApiError, vunaMethods, verifyManagerPin } from "../../../services/vunaApi";

type ManagerPinDialogProps = {
  isOpen: boolean;
  posProfile?: string;
  onCancel: () => void;
  onApproved: () => void;
};

export function ManagerPinDialog({ isOpen, posProfile, onCancel, onApproved }: ManagerPinDialogProps) {
  const call = useFrappePostCall(vunaMethods.verifyManagerPin);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  if (!isOpen) return null;

  const verify = async () => {
    if (!posProfile || !/^\d{4,6}$/.test(pin)) {
      setError("Enter a 4 to 6 digit manager PIN.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await verifyManagerPin(call.call, { pos_profile: posProfile, pin, action: "item_removal" });
      setPin("");
      onApproved();
    } catch (reason) {
      setError(reason instanceof VunaApiError ? reason.message : "Manager PIN verification failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border border-outline-variant bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-on-surface">Manager approval required</h2>
        <p className="mt-1 text-sm text-on-surface-variant">Enter a manager PIN to remove this item from the cart.</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={6}
          className="mt-5 h-12 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-center text-xl tracking-[0.35em] text-on-surface outline-none focus:border-primary"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => { if (event.key === "Enter") void verify(); }}
          disabled={isSubmitting}
        />
        {error ? <p className="mt-3 rounded-md bg-error-container px-3 py-2 text-sm text-on-error-container">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => void verify()} disabled={isSubmitting}>{isSubmitting ? "Verifying…" : "Approve removal"}</Button>
        </div>
      </div>
    </div>
  );
}
