import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import { formatCurrency } from "../../pos/utils";
import type { SessionBillDTO, SessionSettlementDTO } from "../types";

export function WalkoutConfirmation({
  open,
  busy,
  reason,
  balance,
  customer,
  currency,
  error,
  onReason,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  reason: string;
  balance: number;
  customer: string;
  currency?: string;
  error: string;
  onReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      isOpen={open}
      title="Record walkout"
      confirmLabel="Record walkout"
      danger
      description="Keep the charges as an unpaid invoice. This does not record cash, refund payments, or write off the debt. Tables are released only when the invoice is submitted; workflow approval still applies."
      loading={busy}
      confirmDisabled={
        busy || !reason.trim() || reason.length > 500 || balance <= 0
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p className="text-sm">
        Customer: <strong>{customer}</strong>
      </p>
      <p className="mt-2 text-sm">
        Unpaid balance: <strong>{formatCurrency(balance, currency)}</strong>
      </p>
      <p className="mt-2 text-xs text-on-surface-variant">
        Confirmed gateway receipts remain allocated. The remaining balance is
        due today. The customer is not changed.
      </p>
      <label className="mt-4 block text-sm">
        Walkout reason
        <textarea
          className="mt-1 block min-h-24 w-full rounded-md border border-outline-variant bg-surface p-2"
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          maxLength={500}
          disabled={busy}
        />
      </label>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

export function RecordWalkout({
  bill,
  posProfile,
  disabled,
  currency,
  onRecorded,
  onBusy,
}: {
  bill: SessionBillDTO;
  posProfile: string;
  disabled: boolean;
  currency?: string;
  onRecorded: (result: SessionSettlementDTO) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const call = useFrappePostCall(vunaMethods.recordWalkout);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const receipts = bill.gateway_links || [];
  const balance =
    Number(
      bill.invoice.totals.rounded_total || bill.invoice.totals.grand_total
    ) - receipts.reduce((sum, link) => sum + Number(link.amount), 0);
  if (!bill.can_record_walkout || bill.session.status !== "Open") return null;
  const blocked =
    disabled ||
    balance <= 0 ||
    receipts.some(
      (link) =>
        !["Paid", "Authorized"].includes(link.status) || link.handover_required
    );
  const submit = async () => {
    if (running.current || blocked || !reason.trim()) return;
    running.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      const result = unwrapVunaResponse<SessionSettlementDTO>(
        await call.call({
          session: bill.session.name,
          pos_profile: posProfile,
          fingerprint: bill.fingerprint,
          reason: reason.trim(),
        })
      );
      setOpen(false);
      onRecorded(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not record the walkout. The visit was not closed; refresh the bill before retrying."
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        className="text-error"
        disabled={blocked || busy}
        onClick={() => setOpen(true)}
      >
        Record walkout
      </Button>
      <WalkoutConfirmation
        open={open}
        busy={busy}
        reason={reason}
        balance={balance}
        customer={bill.session.customer_name || bill.session.customer}
        currency={currency}
        error={error}
        onReason={setReason}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onConfirm={() => void submit()}
      />
    </>
  );
}
