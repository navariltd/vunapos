import { useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { recoveryProblem } from "../../pos/gatewayRecovery";
import { totalToMinorUnits } from "../../pos/paymentAllocation";
import { CheckoutDialog } from "../../pos/components/CheckoutDialog";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useGatewayPayments } from "../../pos/hooks/useGatewayPayments";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { formatCurrency, getPaymentModes } from "../../pos/utils";
import {
  checkoutSession,
  previewSessionBill,
  searchCheckoutLinkOptions,
  getCustomerAddresses,
  getCustomerLoyalty,
  VunaApiError,
  vunaMethods,
  unwrapVunaResponse,
} from "../../../services/vunaApi";
import { navigateToInvoice } from "../../../lib/stores/navigationStore";
import { Sheet } from "./Sheet";
import { RecordWalkout } from "./RecordWalkout";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { RestaurantSessionDTO, SessionBillDTO } from "../types";
import type {
  PaymentInput,
  CustomerAddressDTO,
  CustomerLoyaltyDTO,
} from "../../pos/types";

/** A session bill is controlled data, never substituted into the retail cart store. */
export function SessionBill({
  session,
  posProfile,
  unsent,
  onChanged,
}: {
  session: RestaurantSessionDTO;
  posProfile: string;
  unsent: boolean;
  onChanged: () => void;
}) {
  const bootstrap = useBootstrapData().data;
  const previewCall = useFrappePostCall(vunaMethods.previewSessionBill);
  const checkoutCall = useFrappePostCall(vunaMethods.checkoutSession);
  const linkOptions = useFrappePostCall(vunaMethods.searchCheckoutLinkOptions);
  const addressCall = useFrappePostCall(vunaMethods.getCustomerAddresses);
  const loyaltyCall = useFrappePostCall(vunaMethods.getCustomerLoyalty);
  const gateway = useGatewayPayments();
  const handoverCall = useFrappePostCall(vunaMethods.handoverSessionPayment);
  const [handover, setHandover] = useState<string | null>(null);
  const [handoverReason, setHandoverReason] = useState("");
  const toast = useUiFeedbackStore((s) => s.showToast);
  const markChanged = useOrderDraftStore((s) => s.markOrdersChanged);
  const [bill, setBill] = useState<SessionBillDTO | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddressDTO[]>([]);
  const [shippingAddress, setShippingAddress] = useState("");
  const [loyalty, setLoyalty] = useState<CustomerLoyaltyDTO | null>(null);
  const running = useRef(false);
  const canPay = Boolean(bootstrap?.can_take_payment);
  const currency = session.currency || bootstrap?.currency;
  const failed = (cause: unknown) => {
    const message =
      cause instanceof Error
        ? cause.message
        : "Unable to prepare the session bill.";
    setError(message);
    toast({ type: "error", message });
  };
  const open = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const [next, loadedAddresses, customerLoyalty] = await Promise.all([
        previewSessionBill(previewCall.call, {
          session: session.name,
          pos_profile: posProfile,
        }),
        getCustomerAddresses(addressCall.call, {
          customer: session.customer,
          pos_profile: posProfile,
        }),
        getCustomerLoyalty(loyaltyCall.call, {
          customer: session.customer,
          pos_profile: posProfile,
        }),
      ]);
      const total = Number(
        next.invoice.totals.rounded_total ||
          next.invoice.totals.grand_total ||
          0
      );
      const problem = recoveryProblem(
        next.gateway_links || [],
        getPaymentModes(bootstrap),
        totalToMinorUnits(total, bootstrap?.currency_precision || 2),
        bootstrap?.currency_precision || 2
      );
      if (problem) setError(problem);
      setAddresses(loadedAddresses);
      setShippingAddress(
        loadedAddresses.find((address) => address.is_default)?.name ||
          loadedAddresses[0]?.name ||
          ""
      );
      setLoyalty(customerLoyalty);
      setBill(next);
    } catch (cause) {
      setBill(null);
      failed(cause);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const confirm = async (
    payments: PaymentInput[],
    _key: string,
    credit: boolean,
    dueDate?: string,
    points?: number,
    taxId?: string,
    shippingAddress?: string,
    fields?: Record<string, string | number | boolean | null>
  ) => {
    if (!bill || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await checkoutSession(checkoutCall.call, {
        session: session.name,
        pos_profile: posProfile,
        fingerprint: bill.fingerprint,
        payments,
        is_credit_sale: credit,
        due_date: dueDate,
        loyalty_points: points,
        tax_id: taxId,
        shipping_address_name: shippingAddress,
        checkout_fields: fields,
      });
      toast({
        type: "info",
        message:
          result.invoice.docstatus === 1
            ? `Bill ${result.invoice.name} completed. The visit is settled and its tables released.`
            : `Bill ${result.invoice.name} saved for workflow approval. The tables remain occupied.`,
      });
      setPaying(false);
      setBill(null);
      markChanged();
      onChanged();
    } catch (cause) {
      failed(cause);
      if (
        cause instanceof VunaApiError &&
        cause.code === "SESSION_BILL_CHANGED"
      ) {
        try {
          setBill(
            await previewSessionBill(previewCall.call, {
              session: session.name,
              pos_profile: posProfile,
            })
          );
        } catch (refreshError) {
          failed(refreshError);
        }
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  if (session.status === "Settled" && !canPay)
    return (
      <span className="text-xs text-primary">
        {session.walkout_reason ? "Walkout recorded" : "Settled"} ·{" "}
        {session.billing_invoice}
      </span>
    );
  if (session.status === "Settled")
    return (
      <Button
        variant="ghost"
        onClick={() => {
          if (session.billing_invoice)
            navigateToInvoice(
              session.billing_invoice,
              session.billing_doctype || "Sales Invoice"
            );
        }}
      >
        {session.walkout_reason ? "View walkout bill" : "View receipt"} ·{" "}
        {session.billing_invoice}
      </Button>
    );
  if (!session.rounds.some((row) => row.status !== "Cancelled")) return null;
  return (
    <>
      <Button
        variant="ghost"
        disabled={unsent || busy || (session.status === "Settling" && !canPay)}
        onClick={() => void open()}
        title={
          unsent
            ? "Place or clear the unsent items before reviewing the full bill."
            : undefined
        }
      >
        {busy
          ? "Preparing bill…"
          : session.status === "Settling"
          ? "View pending bill"
          : "View bill"}
      </Button>
      <Sheet
        isOpen={Boolean(bill) && !paying}
        title="Session bill"
        description={session.name}
        onClose={() => {
          if (!busy) setBill(null);
        }}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setBill(null)}
            >
              Close
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void open()}>
              Refresh bill
            </Button>
            {canPay && bill?.session.status === "Open" ? (
              <RecordWalkout
                bill={bill}
                posProfile={posProfile}
                currency={currency}
                onBusy={setBusy}
                disabled={
                  busy ||
                  bill.can_checkout === false ||
                  Boolean(
                    recoveryProblem(
                      bill.gateway_links || [],
                      getPaymentModes(bootstrap),
                      totalToMinorUnits(
                        Number(
                          bill.invoice.totals.rounded_total ||
                            bill.invoice.totals.grand_total
                        ),
                        bootstrap?.currency_precision || 2
                      ),
                      bootstrap?.currency_precision || 2
                    )
                  )
                }
                onRecorded={(result) => {
                  toast({
                    type: "info",
                    message:
                      result.invoice.docstatus === 1
                        ? `Walkout recorded on ${result.invoice.name}. The unpaid balance remains due; tables are released.`
                        : `Walkout recorded on ${result.invoice.name}. Workflow approval is still required; tables remain occupied.`,
                  });
                  setBill(null);
                  markChanged();
                  onChanged();
                }}
              />
            ) : null}
            {canPay && bill?.session.status === "Open" ? (
              <Button
                disabled={
                  bill.can_checkout === false ||
                  busy ||
                  Boolean(
                    recoveryProblem(
                      bill.gateway_links || [],
                      getPaymentModes(bootstrap),
                      totalToMinorUnits(
                        Number(
                          bill.invoice.totals.rounded_total ||
                            bill.invoice.totals.grand_total
                        ),
                        bootstrap?.currency_precision || 2
                      ),
                      bootstrap?.currency_precision || 2
                    )
                  )
                }
                onClick={() => setPaying(true)}
              >
                Checkout
              </Button>
            ) : null}
          </div>
        }
      >
        {bill?.session.walkout_reason ? (
          <p
            role="status"
            className="mb-4 rounded-md border border-outline-variant p-3 text-sm"
          >
            Walkout: {bill.session.walkout_reason} · Approved by{" "}
            {bill.session.walkout_by}
          </p>
        ) : null}
        {bill?.session.status === "Settling" ? (
          <div
            role="status"
            className="mb-4 space-y-2 rounded-md border border-outline-variant p-3 text-sm"
          >
            <p>
              {bill.invoice.docstatus === 2
                ? "This bill was cancelled. Recorded receipts are not automatically refunded or released; ask accounts to reconcile them."
                : "This bill is saved but not yet submitted. Existing receipts remain allocated; do not collect payment again. Review the invoice workflow to continue."}
            </p>
            {bill.invoice.name ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  navigateToInvoice(bill.invoice.name!, bill.invoice.doctype)
                }
              >
                Open invoice
              </Button>
            ) : null}
          </div>
        ) : null}
        {bill?.gateway_links?.length ? (
          <section
            className="mb-4 space-y-3 border-b border-outline-variant pb-4 text-sm"
            aria-label="Existing visit payments"
          >
            <h3 className="font-semibold">Existing visit payments</h3>
            {bill.gateway_links.map((link) => (
              <div key={link.name}>
                <p className="font-medium">
                  {link.mode_of_payment} ·{" "}
                  {formatCurrency(link.amount, link.currency)} · {link.status}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {link.transaction_reference || link.name} · Original cashier:{" "}
                  {link.cashier} · {link.opening_entry}
                </p>
                {link.remarks ? <p>{link.remarks}</p> : null}
                {link.handover_required ? (
                  <p className="text-error">
                    Manager handover required. Do not take another payment.
                  </p>
                ) : null}
                {link.handover_required && link.can_handover && canPay ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setHandoverReason("");
                      setHandover(link.name);
                    }}
                  >
                    Take over on this till
                  </Button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {bill ? (
          <div className="space-y-4 text-sm">
            {bill.will_complete_preparation ? (
              <p
                role="status"
                className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                This profile completes pending preparation during checkout.
                Remaining transfers/manufacturing will run and KOTs will be
                marked Ready. Stock and production validations still apply.
              </p>
            ) : null}
            {bill.checkout_block_reason ? (
              <p
                role="status"
                className="rounded-md bg-surface-container p-3 text-on-surface-variant"
              >
                {bill.checkout_block_reason}
              </p>
            ) : null}
            <p>
              {session.customer_name} ·{" "}
              {session.tables
                .filter((row) => !row.released_at)
                .map((row) => row.table_label)
                .join(", ") || session.service_type}
            </p>
            {bill.session.status === "Settling" ? (
              <p role="status">
                Invoice {bill.invoice.name} is awaiting workflow approval in
                Desk. The table stays occupied until submission succeeds.
              </p>
            ) : null}
            <ul className="divide-y divide-outline-variant">
              {bill.invoice.items.map((row, index) => (
                <li
                  key={`${row.row_name}-${index}`}
                  className="flex justify-between gap-3 py-2"
                >
                  <span>
                    {row.qty} {row.uom} × {row.item_name}
                    {Number(row.distributed_discount_amount) > 0 ? (
                      <span className="block text-xs text-on-surface-variant">
                        Additional discount (excl. tax):{" "}
                        {formatCurrency(
                          row.distributed_discount_amount,
                          currency
                        )}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(row.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>
                {formatCurrency(bill.invoice.totals.net_total, currency)}
              </span>
            </p>
            {bill.invoice.taxes?.map((tax, index) => (
              <p key={index} className="flex justify-between">
                <span>{tax.description}</span>
                <span>{formatCurrency(tax.tax_amount, currency)}</span>
              </p>
            ))}
            <p className="flex justify-between border-t border-outline-variant pt-3 text-base font-semibold">
              <span>Total</span>
              <span>
                {formatCurrency(
                  bill.invoice.totals.rounded_total ||
                    bill.invoice.totals.grand_total,
                  currency
                )}
              </span>
            </p>
          </div>
        ) : null}
      </Sheet>
      <ConfirmDialog
        isOpen={Boolean(handover)}
        title="Approve payment handover"
        description="Assign this receipt to your current till and open shift. The original cashier and shift remain recorded. This does not charge the customer or refund money."
        confirmLabel="Approve handover"
        loading={busy}
        confirmDisabled={busy || !handoverReason.trim()}
        onCancel={() => {
          if (!busy) setHandover(null);
        }}
        onConfirm={() => {
          if (!handover || busy) return;
          setBusy(true);
          void handoverCall
            .call({
              link: handover,
              session: session.name,
              pos_profile: posProfile,
              reason: handoverReason.trim(),
            })
            .then((result) => {
              unwrapVunaResponse(result);
              setHandover(null);
              return open();
            })
            .catch(failed)
            .finally(() => setBusy(false));
        }}
      >
        <label className="block text-sm">
          Reason
          <textarea
            className="mt-1 w-full rounded-md border border-outline-variant bg-surface p-2"
            maxLength={500}
            value={handoverReason}
            onChange={(event) => setHandoverReason(event.target.value)}
          />
        </label>
      </ConfirmDialog>
      <CheckoutDialog
        isOpen={paying && Boolean(bill)}
        presentation={{ invoice: bill?.invoice || null, isSubmitting: busy }}
        hideCartActions
        initialGatewayLinks={bill?.gateway_links}
        modesOfPayment={getPaymentModes(bootstrap)}
        currency={currency || undefined}
        currencyPrecision={bootstrap?.currency_precision}
        customer={{
          customer: session.customer,
          customer_name: session.customer_name,
        }}
        customerAddresses={addresses}
        shippingAddressName={shippingAddress}
        onShippingAddressChange={setShippingAddress}
        customerLoyalty={loyalty}
        allowCreditSales={bootstrap?.allow_credit_sales}
        allowPartialPayment={bootstrap?.allow_partial_payment}
        autoAllocatePaymentBalance={bootstrap?.auto_allocate_payment_balance}
        defaultSaleType={bootstrap?.default_sale_type}
        checkoutFields={bootstrap?.checkout_fields}
        workflow={bootstrap?.workflow}
        error={error}
        posProfile={posProfile}
        onSearchCheckoutLinkOptions={(params) =>
          searchCheckoutLinkOptions(linkOptions.call, params)
        }
        onClear={() => {}}
        onHold={() => {}}
        onClose={() => {
          if (!busy) {
            setPaying(false);
            // Refresh persisted gateway state before another checkout mount.
            // Back must not forget a prompt and invite a second STK charge.
            void open();
          }
        }}
        onConfirm={(...args) => void confirm(...args)}
        onPreviewLoyalty={async (points) => {
          const next = await previewSessionBill(previewCall.call, {
            session: session.name,
            pos_profile: posProfile,
            loyalty_points: points,
          });
          if (next.gateway_links?.length)
            throw new Error(
              "Resolve the active gateway prompt before changing loyalty redemption."
            );
          setBill(next);
          return next.invoice;
        }}
        onResolveCustomerPhone={gateway.getCustomerContactPhone}
        onCheckGatewayPayment={gateway.getGatewayPaymentStatus}
        onCancelGatewayPayment={gateway.cancelGatewayPaymentLink}
        onInitiateGatewayPayment={(params) =>
          gateway.initiateStkPayment({
            ...params,
            pos_profile: posProfile,
            customer: session.customer,
            currency: currency || undefined,
            account_reference: bill?.account_reference,
            restaurant_session: session.name,
            bill_fingerprint: bill?.fingerprint,
            loyalty_points: bill?.invoice.loyalty_points || undefined,
          })
        }
        onAttachC2bGatewayPayment={(params) =>
          gateway.attachC2bPayment({
            ...params,
            pos_profile: posProfile,
            customer: session.customer,
            currency: currency || undefined,
            restaurant_session: session.name,
            bill_fingerprint: bill?.fingerprint,
            loyalty_points: bill?.invoice.loyalty_points || undefined,
          })
        }
        onSearchC2bGatewayPayments={(params) =>
          gateway.searchC2bPayments({
            ...params,
            pos_profile: posProfile,
            customer: session.customer,
            currency: currency || undefined,
          })
        }
      />
    </>
  );
}
