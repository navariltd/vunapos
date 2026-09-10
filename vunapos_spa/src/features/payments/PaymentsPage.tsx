import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { CreditCard, Search } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { navigateToPosPage } from "../../lib/stores/navigationStore";
import { unwrapVunaResponse, vunaMethods } from "../../services/vunaApi";
import { useCustomerSearch } from "../pos/hooks/useCustomerSearch";
import { useGatewayPaymentRealtime } from "../pos/hooks/useGatewayPaymentRealtime";
import type {
  CustomerDetailsDTO,
  GatewayPaymentLinkDTO,
  ModeOfPaymentDTO,
} from "../pos/types";

type Props = {
  allowHistory?: boolean;
  allowReceive?: boolean;
  allowReconciliation?: boolean;
  posProfile?: string;
  currency?: string;
  paymentModes: ModeOfPaymentDTO[];
  isOnline: boolean;
};
type Candidate = {
  name: string;
  posting_date: string;
  amount: number;
  currency?: string;
  outstanding_amount?: number;
  remarks?: string;
};
type Candidates = { payments: Candidate[]; invoices: Candidate[] };
type Allocation = {
  payment_entry: string;
  invoice: string;
  allocated_amount: number;
  currency?: string;
};
type PaymentHistoryRow = Candidate & {
  customer: string;
  customer_name?: string;
  mode_of_payment?: string;
  received_amount: number;
  unallocated_amount: number;
  allocated_amount: number;
  reference_no?: string;
  remarks?: string;
  status: string;
  cashier?: string;
  receipt_type?: string;
  closing_entry?: string;
  references: Array<{
    reference_doctype: string;
    reference_name: string;
    allocated_amount: number;
  }>;
  gateway_links?: Array<{
    name: string;
    source_doctype: string;
    source_name: string;
    status: string;
    transaction_reference?: string | null;
  }>;
};
type HistoryFilters = {
  customer: string;
  from_date: string;
  to_date: string;
  mode_of_payment: string;
  reference: string;
  status: string;
  cashier: string;
};
type PaymentTab = "receive" | "reconcile" | "history";
const PAYMENT_TAB_STORAGE_KEY = "vunapos.payments-tab";
const PAYMENT_HISTORY_FILTERS_STORAGE_KEY = "vunapos.payment-history-filters";
const EMPTY_HISTORY_FILTERS: HistoryFilters = { customer: "", from_date: "", to_date: "", mode_of_payment: "", reference: "", status: "", cashier: "" };
function readPaymentHistoryFilters(): HistoryFilters {
  if (typeof window === "undefined") return EMPTY_HISTORY_FILTERS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(PAYMENT_HISTORY_FILTERS_STORAGE_KEY) || "null");
    return saved && typeof saved === "object" ? { ...EMPTY_HISTORY_FILTERS, ...saved } : EMPTY_HISTORY_FILTERS;
  } catch { return EMPTY_HISTORY_FILTERS; }
}
const fieldClass =
  "mt-1 w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function PaymentsPage({
  allowHistory = true,
  allowReceive = true,
  allowReconciliation = true,
  posProfile,
  currency,
  paymentModes,
  isOnline,
}: Props) {
  const initial = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const availableTabs = useMemo(
    () =>
      [
        allowReceive ? "receive" : null,
        allowReconciliation ? "reconcile" : null,
        allowHistory ? "history" : null,
      ].filter(Boolean) as Array<"receive" | "reconcile" | "history">,
    [allowHistory, allowReceive, allowReconciliation],
  );
  const [tab, setTab] = useState<PaymentTab>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(PAYMENT_TAB_STORAGE_KEY);
      if (saved === "receive" || saved === "reconcile" || saved === "history") {
        return saved;
      }
    }
    return availableTabs[0] || "receive";
  });
  const activeTab = availableTabs.includes(tab)
    ? tab
    : availableTabs[0] || "receive";
  useEffect(() => {
    if (activeTab !== tab) {
      setTab(activeTab);
      return;
    }
    window.localStorage.setItem(PAYMENT_TAB_STORAGE_KEY, activeTab);
  }, [activeTab, tab]);
  const [receiveCustomer, setReceiveCustomer] = useState(
    initial.get("customer") || "",
  );
  const [invoice, setInvoice] = useState(initial.get("invoice") || "");
  const [query, setQuery] = useState("");
  const search = useCustomerSearch(query);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(
    paymentModes.find((row) => row.default)?.mode_of_payment ||
      paymentModes[0]?.mode_of_payment ||
      "",
  );
  const [referenceNo, setReferenceNo] = useState("");
  const [referenceDate, setReferenceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [gatewayPhone, setGatewayPhone] = useState("");
  const [gatewayReference, setGatewayReference] = useState("");
  const [gatewayLink, setGatewayLink] = useState<GatewayPaymentLinkDTO | null>(
    null,
  );
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState<
    "stk" | "c2b" | "status" | "cancel" | null
  >(null);

  const [reconcileCustomer, setReconcileCustomer] = useState("");
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [allocationPreview, setAllocationPreview] = useState<Allocation[]>([]);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(readPaymentHistoryFilters);
  useEffect(() => {
    window.localStorage.setItem(PAYMENT_HISTORY_FILTERS_STORAGE_KEY, JSON.stringify(historyFilters));
  }, [historyFilters]);

  const receiveCall = useFrappePostCall(vunaMethods.receiveCustomerPayment);
  const initiateStkCall = useFrappePostCall(
    vunaMethods.initiateStkGatewayPayment,
  );
  const statusCall = useFrappePostCall(vunaMethods.getGatewayPaymentStatus);
  const cancelCall = useFrappePostCall(vunaMethods.cancelGatewayPaymentLink);
  const attachC2bCall = useFrappePostCall(vunaMethods.attachC2bGatewayPayment);
  const allocateCall = useFrappePostCall(vunaMethods.allocateCustomerPayments);
  const reconcileCall = useFrappePostCall(vunaMethods.reconcileCustomerPayment);
  const detailsCall = useFrappeGetCall<unknown>(
    vunaMethods.getCustomerDetails,
    { pos_profile: posProfile, customer: receiveCustomer },
    allowReceive && posProfile && receiveCustomer && isOnline
      ? ["vunapos_payment_customer", posProfile, receiveCustomer, message]
      : null,
  );
  const candidatesCall = useFrappeGetCall<unknown>(
    vunaMethods.getReconciliationCandidates,
    { pos_profile: posProfile, customer: reconcileCustomer },
    allowReconciliation && posProfile && reconcileCustomer && isOnline
      ? [
          "vunapos_native_reconciliation",
          posProfile,
          reconcileCustomer,
          message,
        ]
      : null,
  );
  const historyCall = useFrappeGetCall<unknown>(
    vunaMethods.getPaymentHistory,
    { pos_profile: posProfile, ...historyFilters },
    allowHistory && posProfile && isOnline && activeTab === "history"
      ? ["vunapos_payment_history", posProfile, historyFilters, message]
      : null,
  );
  let details: CustomerDetailsDTO | null = null;
  let candidates: Candidates = { payments: [], invoices: [] };
  let loadError: string | null = null;
  let history: PaymentHistoryRow[] = [];
  try {
    if (detailsCall.data)
      details = unwrapVunaResponse<CustomerDetailsDTO>(detailsCall.data);
  } catch (err) {
    loadError = errorText(err);
  }
  try {
    if (candidatesCall.data)
      candidates = unwrapVunaResponse<Candidates>(candidatesCall.data);
  } catch (err) {
    loadError = errorText(err);
  }
  try {
    if (historyCall.data)
      history = unwrapVunaResponse<{ payments: PaymentHistoryRow[] }>(
        historyCall.data,
      ).payments;
  } catch (err) {
    loadError = errorText(err);
  }
  const outstanding =
    details?.invoices.filter(
      (row) => !row.is_return && row.outstanding_amount > 0,
    ) || [];
  const selectedOutstanding = outstanding.find(
    (row) => row.name === invoice,
  )?.outstanding_amount;
  const displayedAmount =
    amount ||
    (invoice && selectedOutstanding !== undefined
      ? String(selectedOutstanding)
      : "");
  const selectedMode = paymentModes.find((row) => row.mode_of_payment === mode);
  const requiresReference = Boolean(selectedMode?.requires_reference);
  const isGatewayMode = Boolean(selectedMode?.payment_gateway);
  const gatewayAmount = Number(displayedAmount);

  useGatewayPaymentRealtime((event) => {
    setGatewayLink((current) =>
      current?.name === event.name ? event : current,
    );
  });

  const clearGatewayState = () => {
    setGatewayLink(null);
    setGatewayError(null);
    setGatewayBusy(null);
  };

  const gatewayAction = async (
    action: "stk" | "c2b" | "status" | "cancel",
    run: () => Promise<GatewayPaymentLinkDTO>,
  ) => {
    setGatewayBusy(action);
    setGatewayError(null);
    try {
      setGatewayLink(await run());
    } catch (err) {
      setGatewayError(errorText(err));
    } finally {
      setGatewayBusy(null);
    }
  };

  async function receive() {
    setError(null);
    setMessage(null);
    if (!allowReceive) {
      setError("Receiving customer payments is disabled for this POS Profile.");
      return;
    }
    if (
      !isOnline ||
      !receiveCustomer ||
      !mode ||
      !(Number(displayedAmount) > 0)
    ) {
      setError(
        "Select a customer, payment mode, and valid amount while online.",
      );
      return;
    }
    if (isGatewayMode && gatewayLink?.status !== "Paid") {
      setError(
        `${mode} requires a verified gateway payment before receiving money.`,
      );
      return;
    }
    if (
      !isGatewayMode &&
      requiresReference &&
      (!referenceNo.trim() || !referenceDate)
    ) {
      setError(
        "Reference No and Reference Date are required for bank payments.",
      );
      return;
    }
    try {
      const response = await receiveCall.call({
        pos_profile: posProfile,
        customer: receiveCustomer,
        amount: Number(displayedAmount),
        mode_of_payment: mode,
        sales_invoice: invoice || undefined,
        allocated_amount: invoice ? Number(displayedAmount) : undefined,
        reference_no: !isGatewayMode && referenceNo ? referenceNo : undefined,
        reference_date:
          !isGatewayMode && referenceNo ? referenceDate : undefined,
        remarks: remarks || undefined,
        idempotency_key: idempotencyKey.current,
        gateway_payment_link: isGatewayMode ? gatewayLink?.name : undefined,
      });
      const created = unwrapVunaResponse<{ name: string }>(response);
      setMessage(`Payment Entry ${created.name} was submitted successfully.`);
      idempotencyKey.current = crypto.randomUUID();
      setAmount("");
      setInvoice("");
      setReferenceNo("");
      setRemarks("");
      setGatewayPhone("");
      setGatewayReference("");
      clearGatewayState();
      await detailsCall.mutate();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function allocate() {
    setError(null);
    setMessage(null);
    setAllocationPreview([]);
    if (!allowReconciliation) {
      setError("Payment reconciliation is disabled for this POS Profile.");
      return;
    }
    if (
      !reconcileCustomer ||
      !selectedPayments.length ||
      !selectedInvoices.length
    ) {
      setError(
        "Select a customer, at least one payment, and at least one invoice.",
      );
      return;
    }
    try {
      const response = await allocateCall.call({
        pos_profile: posProfile,
        customer: reconcileCustomer,
        payment_entries: JSON.stringify(selectedPayments),
        invoices: JSON.stringify(selectedInvoices),
      });
      const preview = unwrapVunaResponse<{ allocations: Allocation[] }>(
        response,
      );
      setAllocationPreview(preview.allocations);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function reconcile() {
    setError(null);
    setMessage(null);
    if (!allowReconciliation) {
      setError("Payment reconciliation is disabled for this POS Profile.");
      return;
    }
    if (!allocationPreview.length) {
      setError("Click Allocate and review the allocation first.");
      return;
    }
    try {
      const response = await reconcileCall.call({
        pos_profile: posProfile,
        customer: reconcileCustomer,
        payment_entries: JSON.stringify(selectedPayments),
        invoices: JSON.stringify(selectedInvoices),
      });
      const result = unwrapVunaResponse<{ allocated_amount: number }>(response);
      setMessage(
        `Reconciled ${money(result.allocated_amount, currency)} successfully.`,
      );
      setSelectedPayments([]);
      setSelectedInvoices([]);
      setAllocationPreview([]);
      await candidatesCall.mutate();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Payments</h2>
            <p className="text-sm text-on-surface-variant">
              Receive and reconcile customer payments.
            </p>
          </div>
          <Button onClick={() => navigateToPosPage("Home")}>Back to POS</Button>
        </div>
        {availableTabs.length ? (
          <div className="flex border-b border-outline-variant">
            {allowReceive ? (
              <Tab
                active={activeTab === "receive"}
                onClick={() => setTab("receive")}
              >
                Receive
              </Tab>
            ) : null}
            {allowReconciliation ? (
              <Tab
                active={activeTab === "reconcile"}
                onClick={() => setTab("reconcile")}
              >
                Reconcile
              </Tab>
            ) : null}
            {allowHistory ? (
              <Tab
                active={activeTab === "history"}
                onClick={() => setTab("history")}
              >
                History
              </Tab>
            ) : null}
          </div>
        ) : null}
        {!isOnline ? (
          <Notice error>
            Payments are online-only. Reconnect before continuing.
          </Notice>
        ) : null}
        {error || loadError ? (
          <Notice error>{error || loadError}</Notice>
        ) : null}
        {message ? <Notice>{message}</Notice> : null}
        {!availableTabs.length ? (
          <Notice error>
            All customer payment operations are disabled for this POS Profile.
          </Notice>
        ) : activeTab === "receive" && allowReceive ? (
          <div className="grid gap-4 rounded-lg border border-outline-variant p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <CustomerPicker
                selected={
                  receiveCustomer && details
                    ? details.customer.customer_name
                    : ""
                }
                query={query}
                setQuery={setQuery}
                customers={search.customers}
                onSelect={setReceiveCustomer}
                onClear={() => {
                  setReceiveCustomer("");
                  setInvoice("");
                }}
              />
            </div>
            <label className="text-sm font-medium">
              Apply to invoice
              <select
                className={fieldClass}
                value={invoice}
                onChange={(event) => {
                  const next = event.target.value;
                  setInvoice(next);
                  setAmount(
                    next
                      ? String(
                          outstanding.find((row) => row.name === next)
                            ?.outstanding_amount || "",
                        )
                      : "",
                  );
                  clearGatewayState();
                }}
                disabled={!receiveCustomer}
              >
                <option value="">Customer advance / unallocated</option>
                {outstanding.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name} — {money(row.outstanding_amount, row.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Mode of Payment
              <select
                className={fieldClass}
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value);
                  clearGatewayState();
                }}
              >
                {paymentModes.map((row) => (
                  <option key={row.mode_of_payment}>
                    {row.mode_of_payment}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Amount
              <input
                className={fieldClass}
                type="number"
                min="0"
                step="0.01"
                value={displayedAmount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  clearGatewayState();
                }}
              />
            </label>
            {isGatewayMode ? (
              <GatewayPaymentBox
                amount={gatewayAmount}
                busy={gatewayBusy}
                currency={currency}
                error={gatewayError}
                gatewayLink={gatewayLink}
                mode={mode}
                phone={gatewayPhone}
                reference={gatewayReference}
                onAttachC2b={() =>
                  void gatewayAction("c2b", async () =>
                    unwrapVunaResponse<GatewayPaymentLinkDTO>(
                      await attachC2bCall.call({
                        pos_profile: posProfile,
                        mode_of_payment: mode,
                        transaction_reference: gatewayReference,
                        amount: gatewayAmount,
                        customer: receiveCustomer,
                        currency,
                        idempotency_key: `${idempotencyKey.current}:${mode}:customer-payment:c2b:${gatewayReference}`,
                      }),
                    ),
                  )
                }
                onCancel={() =>
                  gatewayLink
                    ? void gatewayAction("cancel", async () =>
                        unwrapVunaResponse<GatewayPaymentLinkDTO>(
                          await cancelCall.call({
                            gateway_payment_link: gatewayLink.name,
                          }),
                        ),
                      )
                    : undefined
                }
                onCheckStatus={() =>
                  gatewayLink
                    ? void gatewayAction("status", async () =>
                        unwrapVunaResponse<GatewayPaymentLinkDTO>(
                          await statusCall.call({
                            gateway_payment_link: gatewayLink.name,
                          }),
                        ),
                      )
                    : undefined
                }
                onInitiateStk={() =>
                  void gatewayAction("stk", async () =>
                    unwrapVunaResponse<GatewayPaymentLinkDTO>(
                      await initiateStkCall.call({
                        pos_profile: posProfile,
                        mode_of_payment: mode,
                        amount: gatewayAmount,
                        phone_number: gatewayPhone,
                        customer: receiveCustomer,
                        currency,
                        idempotency_key: `${idempotencyKey.current}:${mode}:customer-payment:stk`,
                      }),
                    ),
                  )
                }
                onPhoneChange={setGatewayPhone}
                onReferenceChange={setGatewayReference}
              />
            ) : (
              <>
                <label className="text-sm font-medium">
                  Reference No{requiresReference ? " *" : ""}
                  <input
                    className={fieldClass}
                    required={requiresReference}
                    value={referenceNo}
                    onChange={(event) => setReferenceNo(event.target.value)}
                    placeholder={
                      requiresReference
                        ? "Required for bank payment"
                        : "Optional"
                    }
                  />
                </label>
                {requiresReference || referenceNo ? (
                  <label className="text-sm font-medium">
                    Reference Date{requiresReference ? " *" : ""}
                    <input
                      className={fieldClass}
                      required={requiresReference}
                      type="date"
                      value={referenceDate}
                      onChange={(event) => setReferenceDate(event.target.value)}
                    />
                  </label>
                ) : null}
              </>
            )}
            <label className="text-sm font-medium md:col-span-2">
              Remarks
              <textarea
                className={fieldClass}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </label>
            <Button
              className="md:col-span-2"
              disabled={
                !isOnline ||
                receiveCall.loading ||
                !receiveCustomer ||
                (isGatewayMode
                  ? gatewayLink?.status !== "Paid"
                  : requiresReference &&
                    (!referenceNo.trim() || !referenceDate))
              }
              onClick={receive}
            >
              <CreditCard className="mr-2 size-4" />
              {receiveCall.loading
                ? "Submitting..."
                : invoice
                  ? "Receive and allocate payment"
                  : "Receive customer advance"}
            </Button>
          </div>
        ) : activeTab === "reconcile" && allowReconciliation ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-outline-variant p-4">
              <CustomerPicker
                selected={reconcileCustomer ? reconcileCustomer : ""}
                query={query}
                setQuery={setQuery}
                customers={search.customers}
                onSelect={(value) => {
                  setReconcileCustomer(value);
                  setSelectedPayments([]);
                  setSelectedInvoices([]);
                  setAllocationPreview([]);
                }}
                onClear={() => setReconcileCustomer("")}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SelectionList
                title="Unallocated payments"
                empty="No unallocated payments for this customer."
                rows={candidates.payments}
                selected={selectedPayments}
                onToggle={(name) => {
                  toggle(name, selectedPayments, setSelectedPayments);
                  setAllocationPreview([]);
                }}
              />
              <SelectionList
                title="Outstanding invoices"
                empty="No outstanding invoices for this customer."
                rows={candidates.invoices}
                selected={selectedInvoices}
                onToggle={(name) => {
                  toggle(name, selectedInvoices, setSelectedInvoices);
                  setAllocationPreview([]);
                }}
                invoices
              />
            </div>
            <div className="flex justify-end">
              <Button
                disabled={
                  !isOnline ||
                  allocateCall.loading ||
                  !selectedPayments.length ||
                  !selectedInvoices.length
                }
                onClick={allocate}
              >
                {allocateCall.loading ? "Allocating..." : "Allocate"}
              </Button>
            </div>
            {allocationPreview.length ? (
              <div className="rounded-lg border border-outline-variant">
                <div className="bg-surface-container-low px-4 py-3 font-semibold">
                  Allocation preview
                </div>
                {allocationPreview.map((row, index) => (
                  <div
                    key={`${row.payment_entry}-${row.invoice}-${index}`}
                    className="grid gap-1 border-t border-outline-variant px-4 py-3 text-sm sm:grid-cols-[1fr_auto_1fr]"
                  >
                    <span>{row.payment_entry}</span>
                    <strong>
                      {money(row.allocated_amount, row.currency || currency)} →
                    </strong>
                    <span>{row.invoice}</span>
                  </div>
                ))}
                <div className="flex justify-end border-t border-outline-variant p-4">
                  <Button disabled={reconcileCall.loading} onClick={reconcile}>
                    {reconcileCall.loading ? "Reconciling..." : "Reconcile"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : allowHistory ? (
          <PaymentHistory
            rows={history}
            filters={historyFilters}
            setFilters={setHistoryFilters}
            paymentModes={paymentModes}
            currency={currency}
            loading={historyCall.isLoading}
          />
        ) : null}
      </div>
    </section>
  );
}

function GatewayPaymentBox({
  amount,
  busy,
  currency,
  error,
  gatewayLink,
  mode,
  phone,
  reference,
  onAttachC2b,
  onCancel,
  onCheckStatus,
  onInitiateStk,
  onPhoneChange,
  onReferenceChange,
}: {
  amount: number;
  busy: "stk" | "c2b" | "status" | "cancel" | null;
  currency?: string;
  error: string | null;
  gatewayLink: GatewayPaymentLinkDTO | null;
  mode: string;
  phone: string;
  reference: string;
  onAttachC2b: () => void;
  onCancel?: () => void;
  onCheckStatus?: () => void;
  onInitiateStk: () => void;
  onPhoneChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
}) {
  const paid = gatewayLink?.status === "Paid";
  return (
    <div className="space-y-3 rounded-lg border border-outline-variant bg-surface-container-low p-3 text-sm md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{mode} gateway payment</p>
          <p className="text-xs text-on-surface-variant">
            Receive this payment through the configured gateway before
            submitting the Payment Entry.
          </p>
        </div>
        <span
          className={
            paid ? "font-medium text-secondary" : "text-on-surface-variant"
          }
        >
          {paid
            ? `Paid${gatewayLink?.transaction_reference ? ` · ${gatewayLink.transaction_reference}` : ""}`
            : gatewayLink
              ? `Status: ${gatewayLink.status}`
              : `Amount ${money(amount || 0, currency)}`}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <input
          className={fieldClass}
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          placeholder="Phone number for STK push"
        />
        <Button
          variant="ghost"
          disabled={!amount || busy !== null}
          onClick={onInitiateStk}
        >
          {busy === "stk" ? "Sending..." : "Send STK"}
        </Button>
        <Button
          variant="ghost"
          disabled={!gatewayLink || busy !== null}
          onClick={onCheckStatus}
        >
          {busy === "status" ? "Checking..." : "Check status"}
        </Button>
        <Button
          variant="ghost"
          disabled={!gatewayLink || paid || busy !== null}
          onClick={onCancel}
        >
          {busy === "cancel" ? "Cancelling..." : "Cancel"}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          className={fieldClass}
          value={reference}
          onChange={(event) => onReferenceChange(event.target.value)}
          placeholder="C2B transaction reference"
        />
        <Button
          variant="ghost"
          disabled={!amount || !reference.trim() || busy !== null}
          onClick={onAttachC2b}
        >
          {busy === "c2b" ? "Checking..." : "Attach C2B"}
        </Button>
      </div>
      {error ? <p className="text-xs text-error">{error}</p> : null}
    </div>
  );
}

function PaymentHistory({
  rows,
  filters,
  setFilters,
  paymentModes,
  currency,
  loading,
}: {
  rows: PaymentHistoryRow[];
  filters: HistoryFilters;
  setFilters: (value: HistoryFilters) => void;
  paymentModes: ModeOfPaymentDTO[];
  currency?: string;
  loading: boolean;
}) {
  const update = (field: string, value: string) =>
    setFilters({ ...filters, [field]: value });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-outline-variant p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          className={fieldClass}
          placeholder="Customer ID"
          value={filters.customer}
          onChange={(event) => update("customer", event.target.value)}
        />
        <input
          className={fieldClass}
          type="date"
          aria-label="From date"
          value={filters.from_date}
          onChange={(event) => update("from_date", event.target.value)}
        />
        <input
          className={fieldClass}
          type="date"
          aria-label="To date"
          value={filters.to_date}
          onChange={(event) => update("to_date", event.target.value)}
        />
        <select
          className={fieldClass}
          value={filters.mode_of_payment}
          onChange={(event) => update("mode_of_payment", event.target.value)}
        >
          <option value="">All payment modes</option>
          {paymentModes.map((row) => (
            <option key={row.mode_of_payment}>{row.mode_of_payment}</option>
          ))}
        </select>
        <input
          className={fieldClass}
          placeholder="External reference"
          value={filters.reference}
          onChange={(event) => update("reference", event.target.value)}
        />
        <select
          className={fieldClass}
          value={filters.status}
          onChange={(event) => update("status", event.target.value)}
        >
          <option value="">All statuses</option>
          <option>Submitted</option>
          <option>Cancelled</option>
        </select>
        <input
          className={fieldClass}
          placeholder="Cashier email"
          value={filters.cashier}
          onChange={(event) => update("cashier", event.target.value)}
        />
        <Button
          variant="ghost"
          onClick={() =>
            setFilters({
              customer: "",
              from_date: "",
              to_date: "",
              mode_of_payment: "",
              reference: "",
              status: "",
              cashier: "",
            })
          }
        >
          Clear filters
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-outline-variant">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-container-low text-xs text-on-surface-variant">
            <tr>
              <th className="px-3 py-3">Payment</th>
              <th>Customer</th>
              <th>Date / mode</th>
              <th>Received</th>
              <th>Invoices</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center">
                  Loading payments...
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr
                  key={row.name}
                  className="border-t border-outline-variant align-top"
                >
                  <td className="px-3 py-3">
                    <a
                      className="font-medium text-primary hover:underline"
                      href={`/app/payment-entry/${encodeURIComponent(row.name)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row.name}
                    </a>
                    <span className="block text-xs text-on-surface-variant">
                      {row.reference_no || "No external reference"}
                    </span>
                    {row.gateway_links?.length
                      ? row.gateway_links.map((link) => (
                          <a
                            key={link.name}
                            className="block text-xs text-primary hover:underline"
                            href={`/app/vunapos-gateway-payment-link/${encodeURIComponent(link.name)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {link.source_doctype}:{" "}
                            {link.transaction_reference || link.source_name}
                          </a>
                        ))
                      : null}
                  </td>
                  <td>
                    {row.customer_name || row.customer}
                    <span className="block text-xs text-on-surface-variant">
                      {row.cashier || "-"}
                    </span>
                  </td>
                  <td>
                    {formatDate(row.posting_date)}
                    <span className="block text-xs text-on-surface-variant">
                      {row.mode_of_payment || "-"}
                    </span>
                  </td>
                  <td>{money(row.received_amount, currency)}</td>
                  <td>
                    {row.references.length
                      ? row.references.map((ref) => (
                          <a
                            key={`${ref.reference_doctype}-${ref.reference_name}`}
                            className="block text-primary hover:underline"
                            href={`/app/${ref.reference_doctype.toLowerCase().replaceAll(" ", "-")}/${encodeURIComponent(ref.reference_name)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {ref.reference_name} (
                            {money(ref.allocated_amount, currency)})
                          </a>
                        ))
                      : "-"}
                  </td>
                  <td>
                    <span
                      className={
                        row.status === "Cancelled"
                          ? "text-error"
                          : "text-secondary"
                      }
                    >
                      {row.status}
                    </span>
                    {row.closing_entry ? (
                      <span className="block text-xs text-on-surface-variant">
                        Shift closed
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-on-surface-variant"
                >
                  No customer payments match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerPicker({
  selected,
  query,
  setQuery,
  customers,
  onSelect,
  onClear,
}: {
  selected: string;
  query: string;
  setQuery: (value: string) => void;
  customers: Array<{
    customer: string;
    customer_name: string;
    mobile_no?: string | null;
  }>;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeWhenOutside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeWhenOutside);
    return () => document.removeEventListener("mousedown", closeWhenOutside);
  }, []);
  if (selected)
    return (
      <div
        ref={pickerRef}
        className="flex items-center justify-between rounded-md bg-surface-container-low p-3"
      >
        <strong>{selected}</strong>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(true);
            onClear();
          }}
        >
          Change
        </Button>
      </div>
    );
  return (
    <div ref={pickerRef} className="relative">
      <label className="flex items-center gap-2 rounded-md border border-outline-variant px-3">
        <Search className="size-4" />
        <input
          className="flex-1 bg-transparent py-2 outline-none"
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder="Search customer"
          aria-expanded={open}
          aria-autocomplete="list"
        />
      </label>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-outline-variant bg-surface shadow-lg">
          {customers.length ? (
            customers.map((row) => (
              <button
                key={row.customer}
                type="button"
                className="block w-full border-t border-outline-variant px-3 py-2 text-left text-sm first:border-t-0 hover:bg-surface-container-low"
                onClick={() => {
                  onSelect(row.customer);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {row.customer_name}
                <span className="ml-2 text-xs text-on-surface-variant">
                  {row.mobile_no || row.customer}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-on-surface-variant">
              No customers found.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SelectionList({
  title,
  empty,
  rows,
  selected,
  onToggle,
  invoices = false,
}: {
  title: string;
  empty: string;
  rows: Candidate[];
  selected: string[];
  onToggle: (name: string) => void;
  invoices?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-outline-variant">
        {rows.length ? (
          rows.map((row) => (
            <label
              key={row.name}
              className="flex cursor-pointer gap-3 border-t border-outline-variant p-3 first:border-t-0 hover:bg-surface-container-low"
            >
              <input
                type="checkbox"
                checked={selected.includes(row.name)}
                onChange={() => onToggle(row.name)}
              />
              <span className="text-sm">
                <strong>{row.name}</strong>
                <span className="block text-xs text-on-surface-variant">
                  {formatDate(row.posting_date)} ·{" "}
                  {invoices ? "Outstanding" : "Available"}{" "}
                  {money(
                    invoices ? row.outstanding_amount || 0 : row.amount,
                    row.currency,
                  )}
                </span>
              </span>
            </label>
          ))
        ) : (
          <p className="p-4 text-sm text-on-surface-variant">{empty}</p>
        )}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      className={`px-5 py-3 text-sm font-medium ${active ? "border-b-2 border-primary text-primary" : "text-on-surface-variant"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Notice({
  error = false,
  children,
}: {
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${error ? "border-error bg-error-container text-on-error-container" : "border-secondary bg-secondary-container text-on-secondary-container"}`}
    >
      {children}
    </div>
  );
}
function toggle(
  value: string,
  selected: string[],
  setSelected: (values: string[]) => void,
) {
  setSelected(
    selected.includes(value)
      ? selected.filter((row) => row !== value)
      : [...selected, value],
  );
}
function money(value: number, currency?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: currency ? "currency" : "decimal",
    currency: currency || undefined,
  }).format(value);
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Payment operation failed";
}
function formatDate(value?: string) {
  if (!value) return "-";
  const date = value.split(" ")[0];
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}
