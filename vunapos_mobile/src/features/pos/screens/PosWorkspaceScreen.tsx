import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/features/shell/components/AppShell";
import { SalespersonPinLock } from "@/features/pos/components/SalespersonPinLock";
import { useSalespersonPin } from "@/features/pos/hooks/useSalespersonPin";
import { PosHomeScreen } from "@/features/pos/screens/PosHomeScreen";
import { PosCartScreen } from "@/features/pos/screens/PosCartScreen";
import { PosCheckoutScreen } from "@/features/pos/screens/PosCheckoutScreen";
import { PosCustomerDetailsScreen } from "@/features/pos/screens/PosCustomerDetailsScreen";
import { PosInvoiceDetailsScreen } from "@/features/pos/screens/PosInvoiceDetailsScreen";
import { PosInvoicesScreen } from "@/features/pos/screens/PosInvoicesScreen";
import { PosPaymentEntryDetailsScreen } from "@/features/pos/screens/PosPaymentEntryDetailsScreen";
import { PosPaymentsScreen } from "@/features/pos/screens/PosPaymentsScreen";
import {
  PosBootstrapData,
  PosInvoicePaymentEntry,
  PosNavigationTab,
  PosOrderType,
  PosSaleCustomer,
} from "@/features/pos/types";
import { usePosCart } from "@/features/pos/hooks/usePosCart";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";

type SelectedInvoice = {
  doctype?: string;
  name: string;
  returnTo?: { doctype?: string; name: string };
};

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const { connectionStatus } = useNetworkStatus();
  const isOffline = connectionStatus === "offline";
  const [activeTab, setActiveTab] = useState<PosNavigationTab>("Home");
  const [cartVisible, setCartVisible] = useState(false);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [cartCurrency, setCartCurrency] = useState("KES");
  const [orderType, setOrderType] = useState<PosOrderType>("Invoice");
  const [selectedInvoice, setSelectedInvoice] =
    useState<SelectedInvoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedPaymentEntry, setSelectedPaymentEntry] = useState<{
    currency: string;
    currencyPrecision: number;
    paymentEntry: PosInvoicePaymentEntry;
  } | null>(null);
  const [saleCustomer, setSaleCustomer] = useState<PosSaleCustomer | null>(
    null,
  );
  const [selectedPriceList, setSelectedPriceList] = useState<string>();
  const [priceListFallbackNotice, setPriceListFallbackNotice] = useState<
    string | null
  >(null);
  const [defaultSaleCustomer, setDefaultSaleCustomer] =
    useState<PosSaleCustomer | null>(null);
  const [posProfile, setPosProfile] = useState<string>();
  const [paymentModes, setPaymentModes] = useState<
    PosBootstrapData["payment_modes"]
  >([]);
  const [posProfileConfig, setPosProfileConfig] =
    useState<PosBootstrapData["pos_profile"]>();
  const [postSaleRefreshKey, setPostSaleRefreshKey] = useState(0);
  const [heldRefreshKey, setHeldRefreshKey] = useState(0);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const cart = usePosCart({
    customer: saleCustomer,
    posProfile,
    priceList: selectedPriceList,
  });
  const salespersonPin = useSalespersonPin();
  const receivePosProfile = useCallback((bootstrap: PosBootstrapData) => {
    const defaultCustomer = bootstrap.default_customer;
    setPosProfile(bootstrap.pos_profile.name);
    setPosProfileConfig(bootstrap.pos_profile);
    setPaymentModes(bootstrap.payment_modes);
    setDefaultSaleCustomer(
      defaultCustomer
        ? {
            customer: defaultCustomer.customer,
            customerName: defaultCustomer.customer_name,
            defaultPriceList: defaultCustomer.default_price_list,
            isWalkin: Boolean(defaultCustomer.is_walkin),
            mobile: defaultCustomer.mobile_no || undefined,
            taxId: defaultCustomer.tax_id || undefined,
          }
        : null,
    );
  }, []);
  const salespersonLocked = Boolean(
    posProfileConfig?.enable_salesperson_pin && !salespersonPin.session,
  );
  const allowsCustomerPayments =
    posProfileConfig?.allow_customer_payments !== false;

  useEffect(() => {
    if (!selectedPriceList || !posProfileConfig) return;
    const permitted =
      posProfileConfig.allowed_price_lists?.map(({ name }) => name) || [];
    if (permitted.includes(selectedPriceList)) return;
    const fallback = setTimeout(() => {
      setSelectedPriceList(undefined);
      setPriceListFallbackNotice(
        "The selected price list is no longer available. Prices were reset to the POS default.",
      );
    }, 0);
    return () => clearTimeout(fallback);
  }, [posProfileConfig, selectedPriceList]);

  function changeTab(tab: PosNavigationTab) {
    setSelectedInvoice(null);
    setSelectedCustomer(null);
    setSelectedPaymentEntry(null);
    setCartVisible(false);
    setCheckoutVisible(false);
    setActiveTab(tab);
  }

  function startSale(customer: PosSaleCustomer) {
    if (isOffline) return;
    cart.clear();
    setSelectedPriceList(undefined);
    setSaleCustomer(customer);
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setSelectedPaymentEntry(null);
    setCheckoutVisible(false);
    setActiveTab("Home");
  }

  return (
    <AppShell
      activeTab={activeTab}
      onOrderTypeChange={setOrderType}
      onTabChange={changeTab}
      orderType={orderType}
      paymentsEnabled={allowsCustomerPayments}
    >
      {selectedPaymentEntry ? (
        <PosPaymentEntryDetailsScreen
          currency={selectedPaymentEntry.currency}
          currencyPrecision={selectedPaymentEntry.currencyPrecision}
          onBack={() => setSelectedPaymentEntry(null)}
          paymentEntry={selectedPaymentEntry.paymentEntry}
        />
      ) : selectedCustomer ? (
        <PosCustomerDetailsScreen
          customer={selectedCustomer}
          onBack={() => setSelectedCustomer(null)}
          onStartSale={startSale}
        />
      ) : selectedInvoice ? (
        <PosInvoiceDetailsScreen
          invoiceDoctype={selectedInvoice.doctype}
          invoiceName={selectedInvoice.name}
          onBack={() => setSelectedInvoice(selectedInvoice.returnTo ?? null)}
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
          onStartSale={startSale}
        />
      ) : checkoutVisible ? (
        <PosCheckoutScreen
          currency={cartCurrency}
          items={cart.items}
          onApplyDeliveryCharge={cart.applyDeliveryCharge}
          onBack={() => setCheckoutVisible(false)}
          onComplete={(result) => {
            cart.clear();
            setSaleCustomer(null);
            setPostSaleRefreshKey((current) => current + 1);
            setHeldRefreshKey((current) => current + 1);
            if (posProfileConfig?.require_pin_before_every_sale)
              salespersonPin.lock();
            setCheckoutVisible(false);
            setCartVisible(false);
            setSelectedInvoice({ doctype: result.doctype, name: result.name });
          }}
          onSalespersonTokenExpired={() => salespersonPin.lock()}
          orderType={orderType}
          priceList={selectedPriceList}
          saleCustomer={saleCustomer}
          salesperson={salespersonPin.session}
          sourceInvoice={cart.sourceInvoice}
          subtotal={cart.subtotal}
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
          hasPendingHold={cart.hasPendingHold}
          holdError={cart.holdError}
          isOffline={isOffline}
          items={cart.items}
          onBack={() => setCartVisible(false)}
          onCheckout={() => {
            if (!cart.requiresCustomer && !cart.isUpdating && !cart.error)
              setCheckoutVisible(true);
          }}
          onClear={cart.clear}
          onHold={async () => {
            const heldInvoice = await cart.hold();
            if (heldInvoice) {
              setSelectedPriceList(undefined);
              setSaleCustomer(defaultSaleCustomer);
              setPostSaleRefreshKey((current) => current + 1);
              setHeldRefreshKey((current) => current + 1);
              setWorkspaceNotice(
                `${heldInvoice.name} is held. You can continue it from Held Invoices.`,
              );
              setCartVisible(false);
              return { name: heldInvoice.name };
            }
            return null;
          }}
          onClearSaleCustomer={() => {
            if (isOffline) return;
            setSelectedPriceList(undefined);
            setSaleCustomer(defaultSaleCustomer);
          }}
          onRemove={cart.remove}
          onSelectSaleCustomer={(customer) => {
            if (isOffline) return;
            setSelectedPriceList(undefined);
            setSaleCustomer(customer);
          }}
          onSelectPriceList={(priceList) => {
            if (isOffline) return;
            setPriceListFallbackNotice(null);
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
          priceListFallbackNotice={priceListFallbackNotice}
          priceListOptions={posProfileConfig?.allowed_price_lists}
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
          onPosProfileLoaded={receivePosProfile}
          pricingContext={{
            customer: saleCustomer?.customer,
            priceList: selectedPriceList,
          }}
          refreshKey={postSaleRefreshKey}
          workspaceNotice={workspaceNotice}
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
          onBackToPos={() => changeTab("Home")}
          paymentModes={paymentModes}
          posProfile={posProfile}
        />
      ) : (
        <PosInvoicesScreen
          heldRefreshKey={heldRefreshKey}
          onBackToPos={() => changeTab("Home")}
          onOpenInvoice={setSelectedInvoice}
          onRestoreHeld={async (invoice) => {
            const restored = await cart.restoreHeldInvoice(invoice);
            setSelectedPriceList(restored.selling_price_list);
            setSaleCustomer(
              restored.customer
                ? {
                    customer: restored.customer,
                    customerName: restored.customer_name || restored.customer,
                  }
                : defaultSaleCustomer,
            );
            setCheckoutVisible(false);
            setCartVisible(true);
            setActiveTab("Home");
            setHeldRefreshKey((current) => current + 1);
          }}
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
