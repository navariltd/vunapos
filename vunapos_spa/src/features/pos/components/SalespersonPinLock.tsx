import { useMemo, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { VunaApiError, vunaMethods, verifySalespersonPin } from "../../../services/vunaApi";

type PinUser = { sales_person: string; display_name?: string; role: "Salesperson" | "Manager" };

type SalespersonPinLockProps = {
  enabled?: boolean;
  posProfile?: string;
  pinUsers?: PinUser[];
	onVerified: (salesperson: string, displayName: string, token: string, expiresIn: number) => void;
};

export function SalespersonPinLock({
  enabled,
  posProfile,
  pinUsers = [],
  onVerified,
}: SalespersonPinLockProps) {
  const call = useFrappePostCall(vunaMethods.verifySalespersonPin);
  const salespeople = useMemo(
    () => pinUsers.filter((row) => row.role === "Salesperson"),
    [pinUsers],
  );
  const [selected, setSelected] = useState(salespeople[0]?.sales_person || "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedSalesperson = salespeople.some((row) => row.sales_person === selected)
    ? selected
    : salespeople[0]?.sales_person || "";

  if (!enabled) return null;

  const verify = async () => {
    if (!posProfile || !selectedSalesperson || !/^\d{4,6}$/.test(pin)) {
      setError("Select a salesperson and enter a 4 to 6 digit PIN.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await verifySalespersonPin(call.call, {
        pos_profile: posProfile,
        salesperson: selectedSalesperson,
        pin,
      });
		onVerified(result.salesperson, result.display_name, result.token, result.expires_in);
      setPin("");
    } catch (reason) {
      setError(reason instanceof VunaApiError ? reason.message : "PIN verification failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4">
      <div className="w-full max-w-md rounded-xl border border-outline-variant bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-primary-container p-3 text-on-primary-container"><LockKeyhole className="size-6" /></span>
          <div>
            <h1 className="text-xl font-semibold text-on-surface">Select salesperson</h1>
            <p className="mt-1 text-sm text-on-surface-variant">Enter the salesperson PIN to unlock this POS.</p>
          </div>
        </div>
        {salespeople.length ? (
          <>
            <label className="mt-6 block text-sm font-medium text-on-surface" htmlFor="salesperson-pin-user">Sales Person</label>
            <select
              id="salesperson-pin-user"
              className="mt-2 h-11 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-on-surface"
              value={selectedSalesperson}
              onChange={(event) => setSelected(event.target.value)}
              disabled={isSubmitting}
            >
              {salespeople.map((row) => <option key={row.sales_person} value={row.sales_person}>{row.display_name || row.sales_person}</option>)}
            </select>
            <label className="mt-4 block text-sm font-medium text-on-surface" htmlFor="salesperson-pin">PIN</label>
            <input
              id="salesperson-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              className="mt-2 h-12 w-full rounded-md border border-outline-variant bg-surface-container-low px-3 text-center text-xl tracking-[0.35em] text-on-surface outline-none focus:border-primary"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => { if (event.key === "Enter") void verify(); }}
              disabled={isSubmitting}
            />
            {error ? <p className="mt-3 rounded-md bg-error-container px-3 py-2 text-sm text-on-error-container">{error}</p> : null}
            <Button className="mt-5 w-full" onClick={() => void verify()} disabled={isSubmitting || !selected}>
              {isSubmitting ? "Verifying…" : "Unlock POS"}
            </Button>
          </>
        ) : (
          <p className="mt-6 rounded-md bg-error-container px-3 py-3 text-sm text-on-error-container">No enabled salesperson PIN is configured for this POS Profile.</p>
        )}
      </div>
    </div>
  );
}
