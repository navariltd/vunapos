import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/features/shell/components/AppShell";
import { SalespersonPinLock } from "@/features/pos/components/SalespersonPinLock";
import { useSalespersonPin } from "@/features/pos/hooks/useSalespersonPin";
import { OpenPosShiftResult } from "@/features/pos/hooks/useOpenPosShift";
import { PosHomeScreen } from "@/features/pos/screens/PosHomeScreen";
import { PosCartScreen } from "@/features/pos/screens/PosCartScreen";
import { PosCheckoutScreen } from "@/features/pos/screens/PosCheckoutScreen";
import { PosCloseShiftScreen } from "@/features/pos/screens/PosCloseShiftScreen";
import {
  initialCustomerDirectoryViewState,
  PosCustomerDirectoryViewState,
  PosCustomersScreen,
} from "@/features/pos/screens/PosCustomersScreen";
import { PosCustomerDetailsScreen } from "@/features/pos/screens/PosCustomerDetailsScreen";
import { PosInvoiceDetailsScreen } from "@/features/pos/screens/PosInvoiceDetailsScreen";
import { PosInvoicesScreen } from "@/features/pos/screens/PosInvoicesScreen";
import { PosPaymentEntryDetailsScreen } from "@/features/pos/screens/PosPaymentEntryDetailsScreen";
import { PosPaymentsScreen } from "@/features/pos/screens/PosPaymentsScreen";
import { PosSessionGateScreen } from "@/features/pos/screens/PosSessionGateScreen";
import type { PosCheckoutFieldValues } from "@/features/pos/components/PosCheckoutFieldsCard";
import {
  PosBootstrapData,
  PosHeldInvoice,
  PosInvoicePaymentEntry,
  PosNavigationTab,
  PosOrderType,
  PosSaleCustomer,
  PosSession,
} from "@/features/pos/types";
import { usePosCart } from "@/features/pos/hooks/usePosCart";
import { usePosCustomerShippingAddresses } from "@/features/pos/hooks/usePosCustomerShippingAddresses";
import { useToast } from "@/components/feedback/ToastProvider";
import { usePosBootstrapConfig } from "@/features/pos/hooks/usePosBootstrap";
import { transactionConfigurationFingerprint } from "@/features/pos/posConfiguration";

type SelectedInvoice = {
  doctype?: string;
  name: string;
  returnTo?: { doctype?: string; name: string };
  returnToCustomer?: string;
};

type ReceivePaymentContext = {
  customer: PosSaleCustomer;
  invoice?: string;
};

function configuredOrderType(
  profile?: PosBootstrapData["pos_profile"],
): PosOrderType {
  return profile?.default_order_type === "Sales Order" ? "Order" : "Invoice";
}

function sessionStateKey(session: PosSession | null | undefined) {
  if (!session) return "";
  return JSON.stringify({
    closing_entry: session.closing_entry,
    has_opening_entry: session.has_opening_entry,
    opening_entry: session.opening_entry,
    ready: session.ready,
    status: session.status,
  });
}

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const toast = useToast();
  // Shell and catalogue consumers read the same root-owned snapshot. This
  // keeps profile state coherent while the app-level coordinator refreshes it.
  const workspaceConfig = usePosBootstrapConfig({
    manageFreshness: false,
  });
  const bootstrap = workspaceConfig.data;
  const posProfileConfig = bootstrap?.pos_profile;
  const posProfile = posProfileConfig?.name;
  const paymentModes = bootstrap?.payment_modes ?? [];
  const defaultSaleCustomer = useMemo<PosSaleCustomer | null>(() => {
    const customer = bootstrap?.default_customer;
    return customer
      ? {
          customer: customer.customer,
          customerName: customer.customer_name,
          defaultPriceList: customer.default_price_list,
          isWalkin: Boolean(customer.is_walkin),
          mobile: customer.mobile_no || undefined,
          taxId: customer.tax_id || undefined,
        }
      : null;
  }, [bootstrap?.default_customer]);
  const [sessionOverride, setSessionOverride] = useState<{
    against: string;
    posProfile?: string;
    session: PosSession;
  } | null>(null);
  const serverSession = bootstrap?.pos_session ?? null;
  const posSession =
    sessionOverride &&
    sessionOverride.posProfile === posProfile &&
    sessionOverride.against === sessionStateKey(serverSession)
      ? sessionOverride.session
      : serverSession;
  const [orderTypeOverride, setOrderTypeOverride] = useState<{
    posProfile?: string;
    restoredDraft?: boolean;
    value: PosOrderType;
  } | null>(null);
  const orderType =
    orderTypeOverride &&
    (orderTypeOverride.restoredDraft ||
      posProfileConfig?.allow_order_type_change !== false) &&
    orderTypeOverride.posProfile === posProfile
      ? orderTypeOverride.value
      : configuredOrderType(posProfileConfig);
  const configurationRefreshKey = useMemo(
    () => (bootstrap ? transactionConfigurationFingerprint(bootstrap) : ""),
    [bootstrap],
  );
  const [activeTab, setActiveTab] = useState<PosNavigationTab>("Home");
  const [cartVisible, setCartVisible] = useState(false);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [cartCurrency, setCartCurrency] = useState("KES");
  const [shippingAddressSelection, setShippingAddressSelection] = useState<{
    customer?: string;
    addressName: string;
  }>({ addressName: "" });
  const [selectedInvoice, setSelectedInvoice] =
    useState<SelectedInvoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [customerDirectoryState, setCustomerDirectoryState] =
    useState<PosCustomerDirectoryViewState>(initialCustomerDirectoryViewState);
  const [receivePaymentContext, setReceivePaymentContext] =
    useState<ReceivePaymentContext | null>(null);
  const [selectedPaymentEntry, setSelectedPaymentEntry] = useState<{
    currency: string;
    currencyPrecision: number;
    paymentEntry: PosInvoicePaymentEntry;
    returnToCustomer?: string;
  } | null>(null);
  const [selectedSaleCustomer, setSelectedSaleCustomer] =
    useState<PosSaleCustomer | null>(null);
  const [selectedPriceList, setSelectedPriceList] = useState<string>();
  const [draftCheckoutFieldValues, setDraftCheckoutFieldValues] =
    useState<PosCheckoutFieldValues>({});
  // A selected customer belongs to the active cart only. The POS Profile
  // default is the fallback for every new cart.
  const saleCustomer = selectedSaleCustomer ?? defaultSaleCustomer;
  const [postSaleRefreshKey, setPostSaleRefreshKey] = useState(0);
  const [heldRefreshKey, setHeldRefreshKey] = useState(0);
  const customerShippingAddresses = usePosCustomerShippingAddresses(
    saleCustomer?.customer,
    posProfile,
  );
  const shippingAddressName =
    shippingAddressSelection.customer === saleCustomer?.customer
      ? shippingAddressSelection.addressName
      : "";
  function setShippingAddressName(addressName: string) {
    setShippingAddressSelection({
      customer: saleCustomer?.customer,
      addressName,
    });
  }
  const cart = usePosCart({
    customer: saleCustomer,
    orderType,
    posProfile,
    priceList: selectedPriceList,
    configurationRefreshKey,
  });
  useEffect(() => {
    if (
      (!cart.restoredCustomer || selectedSaleCustomer) &&
      (!cart.restoredPriceList || selectedPriceList)
    )
      return;
    const restore = setTimeout(() => {
      if (cart.restoredCustomer && !selectedSaleCustomer) {
        setSelectedSaleCustomer(cart.restoredCustomer);
      }
      if (cart.restoredPriceList && !selectedPriceList) {
        setSelectedPriceList(cart.restoredPriceList);
      }
    }, 0);
    return () => clearTimeout(restore);
  }, [
    cart.restoredCustomer,
    cart.restoredPriceList,
    selectedPriceList,
    selectedSaleCustomer,
  ]);
  const salespersonPin = useSalespersonPin();
  const reloadWorkspace = workspaceConfig.reload;
  const handleShiftOpened = useCallback(
    async (result: OpenPosShiftResult) => {
      setSessionOverride({
        against: sessionStateKey(serverSession),
        posProfile,
        session: {
          has_opening_entry: true,
          opening_entry: result.name,
          ready: true,
          status: "OPEN",
        },
      });
      void Promise.resolve(reloadWorkspace());
      toast.success("POS shift opened.");
      setPostSaleRefreshKey((current) => current + 1);
    },
    [posProfile, reloadWorkspace, serverSession, toast],
  );
  const salespersonLocked = Boolean(
    posProfileConfig?.enable_salesperson_pin && !salespersonPin.session,
  );
  const allowsCustomerPayments =
    posProfileConfig?.allow_customer_payments !== false;
  const allowsCustomerManagement = posProfileConfig
    ? posProfileConfig.allow_customer_management !== false
    : false;

  useEffect(() => {
    if (!selectedPriceList || !posProfileConfig) return;
    // A restored draft owns the price list used by that transaction. It may be
    // a customer/context-specific list that is not in the profile's switcher,
    // but it must remain intact while the draft is being edited.
    if (cart.sourceInvoice) return;
    const permitted =
      posProfileConfig.allowed_price_lists?.map(({ name }) => name) || [];
    if (
      !permitted.length ||
      permitted.includes(selectedPriceList) ||
      selectedPriceList === posProfileConfig.price_list
    )
      return;
    const fallback = setTimeout(() => {
      setSelectedPriceList(undefined);
      toast.warning(
        "The selected price list is no longer available. Prices were reset to the POS default.",
        { title: "Price list reset" },
      );
    }, 0);
    return () => clearTimeout(fallback);
  }, [cart.sourceInvoice, posProfileConfig, selectedPriceList, toast]);

  function changeTab(tab: PosNavigationTab) {
    setSelectedInvoice(null);
    setSelectedCustomer(null);
    setSelectedPaymentEntry(null);
    setReceivePaymentContext(null);
    setCartVisible(false);
    setCheckoutVisible(false);
    setActiveTab(tab);
  }

  function startSale(customer: PosSaleCustomer) {
    if (!cart.clear()) return;
    setSelectedPriceList(undefined);
    setDraftCheckoutFieldValues({});
    setSelectedSaleCustomer(customer);
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setSelectedPaymentEntry(null);
    setReceivePaymentContext(null);
    setCheckoutVisible(false);
    setActiveTab("Home");
  }

  function openReceivePayment(customer: PosSaleCustomer, invoice?: string) {
    if (!allowsCustomerPayments) return;
    setSelectedInvoice(null);
    setSelectedCustomer(null);
    setSelectedPaymentEntry(null);
    setCartVisible(false);
    setCheckoutVisible(false);
    setReceivePaymentContext({ customer, invoice });
    setActiveTab("Payments");
  }

  async function restoreDraft(invoice: PosHeldInvoice, checkout = false) {
    const restored = await cart.restoreHeldInvoice(invoice);
    setOrderTypeOverride({
      posProfile,
      restoredDraft: true,
      value: restored.source?.doctype === "Sales Order" ? "Order" : "Invoice",
    });
    setSelectedPriceList(restored.selling_price_list);
    setDraftCheckoutFieldValues(
      Object.fromEntries(
        Object.entries(restored.checkout_field_values ?? {})
          .filter(([, value]) => value !== null && value !== undefined)
          .map(([fieldname, value]) => [fieldname, String(value)]),
      ),
    );
    setSelectedSaleCustomer(
      restored.customer
        ? {
            customer: restored.customer,
            customerName: restored.customer_name || restored.customer,
          }
        : null,
    );
    setCheckoutVisible(checkout);
    setCartVisible(!checkout);
    setShippingAddressName("");
    setActiveTab("Home");
    setHeldRefreshKey((current) => current + 1);
  }

  return (
    <AppShell
      activeTab={activeTab}
      allowOrderTypeChange={posProfileConfig?.allow_order_type_change !== false}
      customersEnabled={allowsCustomerManagement}
      onOrderTypeChange={(nextOrderType) => {
        setOrderTypeOverride({ posProfile, value: nextOrderType });
      }}
      onTabChange={changeTab}
      orderType={orderType}
      paymentsEnabled={allowsCustomerPayments}
    >
      {posSession && !posSession.ready ? (
        <PosSessionGateScreen
          currency={posProfileConfig?.currency}
          onShiftOpened={handleShiftOpened}
          paymentModes={paymentModes}
          posProfile={posProfile}
          session={posSession}
        />
      ) : selectedPaymentEntry ? (
        <PosPaymentEntryDetailsScreen
          currency={selectedPaymentEntry.currency}
          currencyPrecision={selectedPaymentEntry.currencyPrecision}
          onBack={() => {
            const returnToCustomer = selectedPaymentEntry.returnToCustomer;
            setSelectedPaymentEntry(null);
            if (returnToCustomer) setSelectedCustomer(returnToCustomer);
          }}
          paymentEntry={selectedPaymentEntry.paymentEntry}
        />
      ) : selectedCustomer ? (
        <PosCustomerDetailsScreen
          customer={selectedCustomer}
          onBack={() => setSelectedCustomer(null)}
          onOpenInvoice={(invoice) => {
            setSelectedCustomer(null);
            setSelectedInvoice({
              doctype: invoice.doctype,
              name: invoice.name,
              returnToCustomer: selectedCustomer,
            });
          }}
          onOpenPaymentEntry={(payment) => {
            setSelectedCustomer(null);
            setSelectedPaymentEntry({
              currency: posProfileConfig?.currency ?? "KES",
              currencyPrecision: posProfileConfig?.currency_precision ?? 2,
              paymentEntry: {
                allocated_amount: Math.max(
                  payment.received_amount - payment.unallocated_amount,
                  0,
                ),
                docstatus: 1,
                mode_of_payment: payment.mode_of_payment,
                name: payment.name,
                posting_date: payment.posting_date,
                received_amount: payment.received_amount,
                unallocated_amount: payment.unallocated_amount,
              },
              returnToCustomer: selectedCustomer,
            });
          }}
          onReceivePayment={openReceivePayment}
          onStartSale={startSale}
        />
      ) : selectedInvoice ? (
        <PosInvoiceDetailsScreen
          invoiceDoctype={selectedInvoice.doctype}
          invoiceName={selectedInvoice.name}
          onBack={() => {
            if (selectedInvoice.returnTo) {
              setSelectedInvoice(selectedInvoice.returnTo);
              return;
            }
            if (selectedInvoice.returnToCustomer) {
              setSelectedInvoice(null);
              setSelectedCustomer(selectedInvoice.returnToCustomer);
              return;
            }
            setSelectedInvoice(null);
          }}
          onEditDraft={async (source) => {
            const restored = await cart.restoreHeldInvoice(source);
            // A restored draft owns its transaction type. Keep its Sales Order
            // preview path even when the POS Profile defaults to Invoice.
            setOrderTypeOverride({
              posProfile,
              restoredDraft: true,
              value: restored.source?.doctype === "Sales Order" ? "Order" : "Invoice",
            });
            setSelectedPriceList(restored.selling_price_list);
            setDraftCheckoutFieldValues(
              Object.fromEntries(
                Object.entries(restored.checkout_field_values ?? {})
                  .filter(([, value]) => value !== null && value !== undefined)
                  .map(([fieldname, value]) => [fieldname, String(value)]),
              ),
            );
            setSelectedSaleCustomer(
              restored.customer
                ? {
                    customer: restored.customer,
                    customerName: restored.customer_name || restored.customer,
                  }
                : null,
            );
            setSelectedInvoice(null);
            setCheckoutVisible(false);
            setCartVisible(true);
            setActiveTab("Home");
          }}
          onOpenCustomer={setSelectedCustomer}
          onOpenPaymentEntry={(paymentEntry, currency) =>
            setSelectedPaymentEntry({
              currency,
              currencyPrecision: posProfileConfig?.currency_precision ?? 2,
              paymentEntry,
            })
          }
          onOpenReturn={(invoiceReturn) =>
            setSelectedInvoice({
              doctype: selectedInvoice.doctype,
              name: invoiceReturn.name,
              returnTo: selectedInvoice,
            })
          }
          onReceivePayment={openReceivePayment}
          onStartSale={startSale}
        />
      ) : checkoutVisible ? (
        <PosCheckoutScreen
          currency={cartCurrency}
          items={cart.items}
          onApplyDeliveryCharge={cart.applyDeliveryCharge}
          onBack={() => setCheckoutVisible(false)}
          shippingAddressName={shippingAddressName}
          onShippingAddressChange={setShippingAddressName}
          onClear={() => {
            if (!cart.clear()) return;
            setSelectedPriceList(undefined);
            setDraftCheckoutFieldValues({});
            setSelectedSaleCustomer(null);
            setCheckoutVisible(false);
            setCartVisible(false);
          }}
          onComplete={(result) => {
            cart.clear();
            setShippingAddressName("");
            setDraftCheckoutFieldValues({});
            setSelectedSaleCustomer(null);
            // A user override applies only to the sale that was just
            // submitted. Start the next sale from the POS Profile default.
            setOrderTypeOverride(null);
            setHeldRefreshKey((current) => current + 1);
            if (posProfileConfig?.require_pin_before_every_sale)
              salespersonPin.lock();
            setCheckoutVisible(false);
            setCartVisible(false);
            setSelectedInvoice({ doctype: result.doctype, name: result.name });
            const label = result.doctype === "Sales Order" ? "Sales order" : "Sales invoice";
            if (result.queue_status === "Queued" || result.queue_status === "Processing") {
              toast.info(`${label} ${result.name} is queued for server submission.`, {
                title: "Submission queued",
                dedupeKey: `checkout-queued:${result.doctype}:${result.name}`,
              });
            } else if (result.docstatus === 0) {
              toast.info(`${label} ${result.name} was saved as a draft.`, {
                title: "Draft saved",
                dedupeKey: `checkout-draft:${result.doctype}:${result.name}`,
              });
            } else {
              toast.success(`${label} ${result.name} submitted successfully.`, {
                dedupeKey: `checkout-submitted:${result.doctype}:${result.name}`,
              });
            }
          }}
          onHold={async () => {
            const heldInvoice = await cart.hold();
            if (heldInvoice) {
              setSelectedPriceList(undefined);
              setDraftCheckoutFieldValues({});
              setSelectedSaleCustomer(null);
              setPostSaleRefreshKey((current) => current + 1);
              setHeldRefreshKey((current) => current + 1);
              toast.info(`${heldInvoice.name} is held.`, {
                title: "Sale held",
              });
              setCheckoutVisible(false);
              setCartVisible(false);
            }
            return heldInvoice ? { name: heldInvoice.name } : null;
          }}
          onMaterializeGatewayDraft={() => cart.materializeDraft(orderType)}
          onSalespersonTokenExpired={() => salespersonPin.lock()}
          orderType={orderType}
          priceList={selectedPriceList}
          initialCheckoutFieldValues={draftCheckoutFieldValues}
          saleCustomer={saleCustomer}
          salesperson={salespersonPin.session}
          sourceInvoice={cart.sourceInvoice}
          subtotal={cart.subtotal}
          bootstrapData={workspaceConfig.data}
        />
      ) : cartVisible ? (
        <PosCartScreen
          allowCustomerCreation={Boolean(
            posProfileConfig?.allow_customer_creation,
          )}
          allowDiscountChange={Boolean(posProfileConfig?.allow_discount_change)}
          allowRateChange={Boolean(posProfileConfig?.allow_rate_change)}
          currency={cartCurrency}
          currencyPrecision={posProfileConfig?.currency_precision}
          defaultPriceList={posProfileConfig?.price_list}
          hasPendingHold={cart.hasPendingHold}
          holdError={cart.holdError}
          items={cart.items}
          onBack={() => setCartVisible(false)}
          onCheckout={() => {
            if (!cart.requiresCustomer && !cart.isUpdating && !cart.error)
              setCheckoutVisible(true);
          }}
          onClear={() => {
            if (!cart.clear()) return false;
            setShippingAddressName("");
            setSelectedPriceList(undefined);
            setDraftCheckoutFieldValues({});
            setSelectedSaleCustomer(null);
            return true;
          }}
          onHold={async () => {
            const heldInvoice = await cart.hold();
            if (heldInvoice) {
              setSelectedPriceList(undefined);
              setDraftCheckoutFieldValues({});
              setSelectedSaleCustomer(null);
              setPostSaleRefreshKey((current) => current + 1);
              setHeldRefreshKey((current) => current + 1);
              toast.info(`${heldInvoice.name} is held.`, {
                title: "Sale held",
              });
              setCartVisible(false);
              return { name: heldInvoice.name };
            }
            return null;
          }}
          onClearSaleCustomer={() => {
            setSelectedPriceList(undefined);
            setSelectedSaleCustomer(null);
          }}
          onRemove={async (itemCode) => {
            const isRemovingLastItem = cart.itemCount === 1;
            const wasRemoved = await cart.remove(itemCode);
            if (!wasRemoved || !isRemovingLastItem) return;
            setSelectedPriceList(undefined);
            setDraftCheckoutFieldValues({});
            setSelectedSaleCustomer(null);
          }}
          onSelectSaleCustomer={(customer) => {
            setSelectedPriceList(undefined);
            setSelectedSaleCustomer(customer);
          }}
          customerShippingAddresses={customerShippingAddresses.data ?? []}
          customerShippingAddressesLoading={customerShippingAddresses.isLoading}
          shippingAddressName={shippingAddressName}
          onSelectShippingAddress={setShippingAddressName}
          onSelectPriceList={(priceList) => {
            setSelectedPriceList(priceList);
          }}
          onUpdateBatchAllocations={cart.updateBatchAllocations}
          onUpdateItemNote={cart.updateItemNote}
          onUpdatePricing={cart.updatePricing}
          onUpdateQuantity={cart.updateQuantity}
          onUpdateSerialAllocations={cart.updateSerialAllocations}
          onUpdateUom={cart.updateUom}
          orderType={orderType}
          posProfile={posProfile}
          priceList={selectedPriceList}
          priceListOptions={posProfileConfig?.allowed_price_lists}
          resolvedPriceList={cart.sellingPriceList}
          requireManagerPinForItemRemoval={Boolean(
            posProfileConfig?.require_manager_pin_item_removal,
          )}
          allowPriceListSwitching={Boolean(
            posProfileConfig?.allow_price_list_switching,
          )}
          requiresCustomer={cart.requiresCustomer}
          saleCustomer={saleCustomer}
          sourceInvoice={cart.sourceInvoice}
          defaultSaleCustomer={defaultSaleCustomer}
          subtotal={cart.subtotal}
          taxes={cart.taxes}
          totals={cart.totals}
          isHolding={cart.isHolding}
          isUpdating={cart.isUpdating}
          error={cart.error}
          onRetry={() => {
            void cart.retry();
          }}
        />
      ) : activeTab === "Home" ? (
        <PosHomeScreen
          cartItemCount={cart.itemCount}
          onAddToCart={async (item, currency) => {
            setCartCurrency(currency);
            return cart.add(item);
          }}
          onOpenCart={() => setCartVisible(true)}
          orderType={orderType}
          pricingContext={{
            customer: saleCustomer?.customer,
            priceList: selectedPriceList,
          }}
          refreshKey={postSaleRefreshKey}
          useBootstrapCatalogue={!selectedSaleCustomer && !selectedPriceList}
        />
      ) : activeTab === "Payments" ? (
        <PosPaymentsScreen
          allowHistory={posProfileConfig?.allow_payment_history !== false}
          allowReconciliation={
            posProfileConfig?.allow_payment_reconciliation !== false
          }
          allowReceive={allowsCustomerPayments}
          currency={posProfileConfig?.currency ?? "KES"}
          currencyPrecision={posProfileConfig?.currency_precision ?? 2}
          initialReceiveCustomer={receivePaymentContext?.customer}
          initialReceiveInvoice={receivePaymentContext?.invoice}
          paymentModes={paymentModes}
          posProfile={posProfile}
        />
      ) : activeTab === "Customers" ? (
        <PosCustomersScreen
          customerManagementEnabled={allowsCustomerManagement}
          currencyPrecision={posProfileConfig?.currency_precision}
          directoryState={customerDirectoryState}
          onDirectoryStateChange={setCustomerDirectoryState}
          onOpenCustomer={setSelectedCustomer}
          posProfile={posProfile}
        />
      ) : activeTab === "Close Shift" ? (
        <PosCloseShiftScreen
          currency={posProfileConfig?.currency}
          currencyPrecision={posProfileConfig?.currency_precision}
          onShiftClosed={(session) => {
            setSessionOverride({
              against: sessionStateKey(serverSession),
              posProfile,
              session,
            });
            void Promise.resolve(reloadWorkspace());
          }}
          posProfile={posProfile}
        />
      ) : (
        <PosInvoicesScreen
          heldRefreshKey={heldRefreshKey}
          onOpenInvoice={setSelectedInvoice}
          onRestoreHeld={(invoice) => restoreDraft(invoice)}
          onCheckoutHeld={(invoice) => restoreDraft(invoice, true)}
        />
      )}
      <SalespersonPinLock
        error={salespersonPin.error}
        isVerifying={salespersonPin.isVerifying}
        onVerify={(salesperson, pin) =>
          salespersonPin.verify(posProfileConfig?.name || "", salesperson, pin)
        }
        pinUsers={posProfileConfig?.pin_users}
        posProfile={posProfileConfig?.name}
        visible={salespersonLocked}
      />
    </AppShell>
  );
}
