import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { ShoppingCart, X } from "lucide-react";

import type {
  HeldInvoiceDTO,
  ItemDTO,
  PaymentInput,
  PrintPayload,
} from "./types";
import {
  getInvoiceTotal,
  getPaymentModes,
  normalizeDefaultCustomer,
} from "./utils";
import {
	getCustomerFromPath,
	getInvoiceDoctypeFromPath,
	getInvoiceFromPath,
  navigateToPosPage,
  useNavigationStore,
} from "../../lib/stores/navigationStore";
import {
  getItemDetails,
  getProductBundle,
  getTemplateVariants,
  vunaMethods,
  VunaApiError,
} from "../../services/vunaApi";
import { CartPanel } from "./components/CartPanel";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { CustomersPage } from "../customers/CustomersPage";
import { CustomerDetailsPage } from "../customers/CustomerDetailsPage";
import { PaymentsPage } from "../payments/PaymentsPage";
import { CheckoutDialog } from "./components/CheckoutDialog";
import { CloseShiftPage } from "./components/CloseShiftPage";
import { InvoicesPage } from "./components/InvoicesPage";
import { InvoiceDetailsPage } from "./components/InvoiceDetailsPage";
import { ItemGrid } from "./components/ItemGrid";
import { ItemSearch } from "./components/ItemSearch";
import { UserProfilePage } from "./components/UserProfilePage";
import { BarcodeScannerDialog } from "./components/BarcodeScannerDialog";
import {
  VariantPickerDialog,
  type TemplateVariant,
} from "./components/VariantPickerDialog";
import {
  ProductBundleDialog,
  type ProductBundleDetails,
} from "./components/ProductBundleDialog";
import { ManagerPinDialog } from "./components/ManagerPinDialog";
import { SalespersonPinLock } from "./components/SalespersonPinLock";
import { useBootstrapData } from "./hooks/useBootstrapData";
import { useCartActions } from "./hooks/useCartActions";
import { useConnectivity } from "./hooks/useConnectivity";
import { useHeldInvoicesView } from "./hooks/useHeldInvoicesView";
import { useItemSearch } from "./hooks/useItemSearch";
import { useGatewayPayments } from "./hooks/useGatewayPayments";
import { useConfigurationRealtime } from "./hooks/useConfigurationRealtime";
import { useCheckoutQueueRealtime } from "./hooks/useCheckoutQueueRealtime";
import { useCustomerLoyalty } from "./hooks/useCustomerLoyalty";
import { getActiveCustomer, useCartStore } from "./stores/cartStore";
import { useUiFeedbackStore } from "./stores/uiFeedbackStore";
import { hydrate } from "../../lib/cacheEngine";
import type { OrderType } from "../../components/layout/Header";

type POSHomePageProps = {
  bootstrap?: ReturnType<typeof useBootstrapData>;
  orderType?: OrderType;
  salesperson?: { name: string; displayName: string; token: string } | null;
  salespersonLocked?: boolean;
	onSalespersonVerified?: (salesperson: { name: string; displayName: string; token: string; expiresIn: number }) => void;
  onLockSalesperson?: () => void;
};

function printInvoiceHtml(printPayload: PrintPayload) {
  const printFrame = document.createElement("iframe");
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";
  printFrame.setAttribute("aria-hidden", "true");
  document.body.appendChild(printFrame);

  const printDocument = printFrame.contentWindow?.document;
  if (!printDocument) {
    printFrame.remove();
    return;
  }

  printDocument.open();
  printDocument.write(printPayload.html);
  printDocument.close();

  window.setTimeout(() => {
    printFrame.contentWindow?.focus();
    printFrame.contentWindow?.print();
    window.setTimeout(() => printFrame.remove(), 1000);
  }, 100);
}

function getCheckoutErrorMessage(error: unknown) {
  if (error instanceof VunaApiError) {
    if (error.code === "PAYMENT_TOTAL_MISMATCH") {
      return "Payment amount must match the invoice total.";
    }
    if (error.code === "INVOICE_ALREADY_SUBMITTED") {
      return "This invoice has already been submitted.";
    }
    if (error.code === "EMPTY_INVOICE") {
      return "Add at least one item before checkout.";
    }
    if (error.code === "SERVICE_ITEMS_DISABLED") {
      return "Service items are disabled for this POS Profile.";
    }
    if (error.code === "INVALID_DELIVERY_CHARGE_ITEM") {
      return "The configured Delivery Charge Item must have Maintain Stock disabled.";
    }
    if (error.code === "DUPLICATE_DELIVERY_CHARGE") {
      return "Only one Delivery Charge line is allowed on an invoice.";
    }
  }
  return error instanceof Error ? error.message : "Checkout failed";
}

function FeatureDisabled({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center border-t border-outline-variant bg-surface p-6">
      <div className="max-w-md rounded-lg border border-outline-variant bg-surface-container-low p-6 text-center">
        <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
        <p className="mt-2 text-sm text-on-surface-variant">{message}</p>
        <Button className="mt-4" onClick={() => navigateToPosPage("Home")}>
          Back to POS
        </Button>
      </div>
    </section>
  );
}

export function POSHomePage({
  bootstrap: providedBootstrap,
  orderType = "Sales Invoice",
  salesperson,
  salespersonLocked = false,
  onSalespersonVerified,
  onLockSalesperson,
}: POSHomePageProps) {
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
  const [variantPickerItem, setVariantPickerItem] = useState<ItemDTO | null>(null);
  const [variantOptions, setVariantOptions] = useState<TemplateVariant[]>([]);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [bundleItem, setBundleItem] = useState<ItemDTO | null>(null);
  const [bundleDetails, setBundleDetails] = useState<ProductBundleDetails | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [pendingItemCode, setPendingItemCode] = useState<string | null>(null);
  const [clearCartConfirmation, setClearCartConfirmation] = useState<{
    closeCheckout: boolean;
  } | null>(null);
  const [managerPinTarget, setManagerPinTarget] = useState<string | null>(null);
  const lastAutoAddedSearch = useRef("");
  const activePage = useNavigationStore((s) => s.activePage);
  const currentPath = useNavigationStore((s) => s.currentPath);
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const pageError = useUiFeedbackStore((s) => s.pageError);
  const setPageError = useUiFeedbackStore((s) => s.setPageError);
  const toast = useUiFeedbackStore((s) => s.toast);
  const toastClosing = useUiFeedbackStore((s) => s.toastClosing);
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const clearToast = useUiFeedbackStore((s) => s.clearToast);

  const ownBootstrap = useBootstrapData();
  const bootstrap = providedBootstrap || ownBootstrap;
  const defaultCustomer = useMemo(
    () => normalizeDefaultCustomer(bootstrap.data),
    [bootstrap.data],
  );
  const paymentModes = useMemo(
    () => getPaymentModes(bootstrap.data),
    [bootstrap.data],
  );
  const allowCustomerManagement =
    bootstrap.data?.allow_customer_management !== false;
  const allowCustomerCreation =
    bootstrap.data?.allow_customer_creation !== false;
  const allowCustomerPayments =
    bootstrap.data?.allow_customer_payments !== false;

  const items = useItemSearch(itemSearchQuery);
  const cartInvoice = useCartStore((s) => s.invoice);
  const cartQuantity =
    cartInvoice?.items.reduce(
      (total, item) => total + Number(item.qty || 0),
      0,
    ) || 0;
  const selectedPriceList = useCartStore((s) => s.selectedPriceList);
  const activeCustomer = useCartStore(getActiveCustomer);
  const heldInvoicesView = useHeldInvoicesView();
  const cartIsHeldLoading = useCartStore((s) => s.isHeldLoading);
  const cartError = useCartStore((s) => s.error);
  const setCartPosProfile = useCartStore((s) => s.setPosProfile);
  const setCartDefaultCustomer = useCartStore((s) => s.setDefaultCustomer);
  const setSelectedCustomer = useCartStore((s) => s.setSelectedCustomer);
  const cartActions = useCartActions();
  const templateVariantsCall = useFrappePostCall(vunaMethods.getTemplateVariants);
  const productBundleCall = useFrappePostCall(vunaMethods.getProductBundle);
  const itemDetailsCall = useFrappePostCall(vunaMethods.getItemDetails);

  const handleRemoveItem = useCallback(
    (rowName: string) => {
      if (bootstrap.data?.require_manager_pin_item_removal) {
        setManagerPinTarget(rowName);
        return;
      }
      void cartActions.removeCartItem(rowName).catch((reason: unknown) => {
        showToast({
          type: "error",
          message: reason instanceof Error ? reason.message : "Unable to remove item.",
        });
      });
    },
    [bootstrap.data?.require_manager_pin_item_removal, cartActions, showToast],
  );
  const gatewayPayments = useGatewayPayments();
  const { isReachable } = useConnectivity();
  const customerLoyalty = useCustomerLoyalty(
    activeCustomer?.customer,
    bootstrap.data?.pos_profile,
    isReachable && navigator.onLine !== false,
  );
  const handleSelectCustomer = async (
    customer: Parameters<typeof setSelectedCustomer>[0],
    reportError = true,
  ) => {
    setSelectedCustomer(customer);
    if (!isReachable || navigator.onLine === false) return;
    try {
      await cartActions.refreshCustomerPricing(customer);
    } catch (pricingError) {
      if (reportError) {
        showToast({
          type: "error",
          message:
            pricingError instanceof Error
              ? `Customer selected, but prices could not be refreshed: ${pricingError.message}`
              : "Customer selected, but prices could not be refreshed.",
        });
      }
    }
  };
  const handleSelectPriceList = async (priceList?: string) => {
    if (!isReachable || navigator.onLine === false) {
      showToast({
        type: "error",
        message: "Connect to the server before changing the price list.",
      });
      return;
    }
    try {
      await cartActions.refreshPriceListPricing(priceList);
    } catch (pricingError) {
      showToast({
        type: "error",
        message:
          pricingError instanceof Error
            ? pricingError.message
            : "Price list could not be changed.",
      });
    }
  };

  const error = pageError || bootstrap.error || items.error;

  useConfigurationRealtime(async (event) => {
    if (!isReachable || navigator.onLine === false) return;
    try {
      await hydrate(bootstrap.data?.pos_profile);
      const cartState = useCartStore.getState();
      if (cartState.selectedPriceList) {
        try {
          await cartActions.refreshPriceListPricing(
            cartState.selectedPriceList,
          );
        } catch {
          // The profile change may have revoked the selected list. Fall back to
          // the active customer's default list before using the profile default.
          const customer = getActiveCustomer(cartState);
          if (customer) await cartActions.refreshCustomerPricing(customer);
          else await cartActions.refreshPriceListPricing(undefined);
        }
      } else {
        const customer = getActiveCustomer(cartState);
        if (customer) await cartActions.refreshCustomerPricing(customer);
        else if (cartState.invoice?.items.length)
          await cartActions.refreshCartConfiguration();
      }
      showToast({
        type: "info",
        message: `${event.doctype || "POS"} configuration updated.`,
      });
    } catch (refreshError) {
      showToast({
        type: "error",
        message:
          refreshError instanceof Error
            ? `Configuration changed, but VunaPOS could not refresh: ${refreshError.message}`
            : "Configuration changed, but VunaPOS could not refresh.",
      });
    }
  });

  useCheckoutQueueRealtime((event) => {
    if (event.pos_profile !== bootstrap.data?.pos_profile) return;
    if (event.status === "Queued") {
      void hydrate(event.pos_profile).catch((refreshError) => {
        console.error(
          "Unable to refresh stock after queued checkout",
          refreshError,
        );
      });
      return;
    }
    if (event.status === "Submitted") {
      void (async () => {
        try {
          await hydrate(event.pos_profile);
          const cartState = useCartStore.getState();
          if (cartState.selectedPriceList) {
            await cartActions.refreshPriceListPricing(
              cartState.selectedPriceList,
            );
          } else {
            const customer = getActiveCustomer(cartState);
            if (customer) await cartActions.refreshCustomerPricing(customer);
            else if (cartState.invoice?.items.length)
              await cartActions.refreshCartConfiguration();
          }
        } catch (refreshError) {
          console.error(
            "Unable to refresh stock after queued checkout",
            refreshError,
          );
        }
      })();
      customerLoyalty.refresh();
      showToast({
        type: "info",
        message: `Invoice ${event.invoice_name} submitted successfully.`,
      });
      return;
    }
    if (event.status === "Failed" || event.status === "Requires Review") {
      const suffix = event.error
        ? `: ${event.error}`
        : ". Open the Checkout Queue for details.";
      showToast({
        type: "error",
        message: `Invoice ${event.invoice_name} ${event.status === "Requires Review" ? "requires review" : "failed to submit"}${suffix}`,
      });
      return;
    }
    if (event.status === "Cancelled") {
      void hydrate(event.pos_profile).catch((refreshError) => {
        console.error(
          "Unable to refresh stock after queued checkout cancellation",
          refreshError,
        );
      });
      showToast({
        type: "info",
        message: `Queued invoice ${event.invoice_name} was cancelled.`,
      });
    }
  });

  useEffect(() => {
    if (cartError) showToast({ type: "error", message: cartError });
  }, [cartError, showToast]);

  useEffect(() => {
    setCartPosProfile(bootstrap.data?.pos_profile);
  }, [bootstrap.data?.pos_profile, setCartPosProfile]);

  useEffect(() => {
    setCartDefaultCustomer(defaultCustomer);
  }, [defaultCustomer, setCartDefaultCustomer]);

  useEffect(() => {
    // Skip the fetch when offline: frappe-react-sdk throws a raw TypeError on a pure
    // network failure (reads error.response.data unconditionally). isReachable can
    // lag a disconnect by a beat, so also check navigator.onLine as a last-instant guard.
    if (
      !bootstrap.data?.pos_profile ||
      !isReachable ||
      navigator.onLine === false
    ) {
      return;
    }

    cartActions.listHeld().catch((err) => {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to load held invoices",
      });
    });
    // cartActions is a fresh object each render (see useCartActions) - keying on its
    // stable inputs instead avoids re-firing every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap.data?.pos_profile, isReachable, showToast]);

  const openVariantPicker = useCallback(
    async (item: ItemDTO) => {
      setVariantPickerItem(item);
      setVariantOptions([]);
      setVariantError(null);
      try {
        const result = await getTemplateVariants(templateVariantsCall.call, {
          template_item_code: item.item_code,
          pos_profile: bootstrap.data?.pos_profile,
          customer: activeCustomer?.customer,
          price_list:
            selectedPriceList || cartInvoice?.selling_price_list || bootstrap.data?.price_list,
        });
        setVariantOptions(result.variants || []);
      } catch (error) {
        setVariantError(
          error instanceof Error ? error.message : "Unable to load item variants.",
        );
      }
    },
    [
      activeCustomer,
      bootstrap.data,
      cartInvoice,
      selectedPriceList,
      templateVariantsCall.call,
    ],
  );

  const addConcreteItem = useCallback(
    async (item: ItemDTO) => {
      setPageError(null);
      clearToast();
      setPendingItemCode(item.item_code);
      try {
        await cartActions.addCartItem(item);
      } catch (err) {
        showToast({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to add item",
        });
      } finally {
        setPendingItemCode(null);
      }
    },
    [cartActions, clearToast, setPageError, showToast],
  );

  const openProductBundle = useCallback(
    async (item: ItemDTO) => {
      setBundleItem(item);
      setBundleDetails(null);
      setBundleError(null);
      try {
        const result = await getProductBundle(productBundleCall.call, {
          item_code: item.item_code,
          pos_profile: bootstrap.data?.pos_profile,
          customer: activeCustomer?.customer,
          price_list:
            selectedPriceList || cartInvoice?.selling_price_list || bootstrap.data?.price_list,
        });
        setBundleDetails(result);
      } catch (error) {
        setBundleError(
          error instanceof Error ? error.message : "Unable to load bundle components.",
        );
      }
    },
    [
      activeCustomer,
      bootstrap.data,
      cartInvoice,
      productBundleCall.call,
      selectedPriceList,
    ],
  );

  const handleAddItem = useCallback(
    async (item: ItemDTO) => {
      if (item.has_variants) {
        await openVariantPicker(item);
        return;
      }
      if (item.is_product_bundle) {
        await openProductBundle(item);
        return;
      }
      await addConcreteItem(item);
    },
    [addConcreteItem, openProductBundle, openVariantPicker],
  );

  const applyDeliveryCharge = useCallback(
    async (amount?: number) => {
      const itemCode = bootstrap.data?.delivery_charge_item;
      if (!itemCode) return;
      let row = useCartStore.getState().invoice?.items.find((item) => item.item_code === itemCode);
      if (amount === undefined || amount <= 0) {
        if (row) await cartActions.removeCartItem(row.row_name);
        return;
      }
      if (!row) {
        const item = await getItemDetails(itemDetailsCall.call, {
          item_code: itemCode,
          pos_profile: bootstrap.data?.pos_profile,
          customer: activeCustomer?.customer,
          price_list: selectedPriceList || cartInvoice?.selling_price_list || bootstrap.data?.price_list,
        });
        await cartActions.addCartItem(item);
        row = useCartStore.getState().invoice?.items.find((item) => item.item_code === itemCode);
      }
      const rate = amount && Number.isFinite(amount) && amount > 0 ? amount : Number(row?.rate || 0);
      if (row && rate > 0 && Number(row.rate) !== rate) {
        await cartActions.updateCartItemPricing(row.row_name, { type: "rate", value: rate });
      }
    },
    [
      activeCustomer?.customer,
      bootstrap.data,
      cartActions,
      cartInvoice?.selling_price_list,
      itemDetailsCall.call,
      selectedPriceList,
    ],
  );

  const handleSelectVariant = useCallback(
    (variant: TemplateVariant) => {
      setVariantPickerItem(null);
      setVariantOptions([]);
      void addConcreteItem(variant);
    },
    [addConcreteItem],
  );


  useEffect(() => {
    const query = itemSearchQuery.trim();
    if (
      !bootstrap.data?.automatically_add_filtered_item_to_cart ||
      !query ||
      items.isLoading ||
      items.items.length !== 1 ||
      pendingItemCode
    ) {
      return;
    }
    const item = items.items[0];
    const autoAddKey = `${query.toLowerCase()}::${item.item_code}`;
    if (lastAutoAddedSearch.current === autoAddKey) return;
    lastAutoAddedSearch.current = autoAddKey;
    void handleAddItem(item).then(() => setItemSearchQuery(""));
  }, [
    bootstrap.data?.automatically_add_filtered_item_to_cart,
    itemSearchQuery,
    items.isLoading,
    items.items,
    handleAddItem,
    pendingItemCode,
  ]);

  const handleScanBarcode = async (barcode: string) => {
    const value = barcode.trim();
    if (!value) return;
    setPageError(null);
    clearToast();
    if (!isReachable || navigator.onLine === false) {
      showToast({
        type: "error",
        message: "Barcode scanning requires a connection.",
      });
      return;
    }
    try {
      const item = await cartActions.scanBarcode(value);
      setItemSearchQuery("");
      const cartRow = useCartStore
        .getState()
        .invoice?.items.find(
          (row) =>
            row.item_code === item.item_code &&
            (row.uom || row.stock_uom) === (item.uom || item.stock_uom) &&
            Number(row.conversion_factor || 1) ===
              Number(item.conversion_factor || 1),
        );
      showToast({
        type: "info",
        message: `${item.item_name || item.item_code} added to cart${cartRow ? ` · Qty ${cartRow.qty}` : ""}.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Barcode could not be resolved.",
      });
    }
  };

  const handleOpenCheckout = async () => {
    setPageError(null);
    if (!isReachable || navigator.onLine === false) {
      showToast({
        type: "error",
        message: "VunaPOS is online-only. Reconnect before checkout.",
      });
      return;
    }
    if (!activeCustomer?.customer) {
      showToast({
        type: "error",
        message:
          "Select a customer, or set a default customer on this POS Profile, before checkout",
      });
      return;
    }
    try {
      const validated = await cartActions.validateCart();
      if (!validated) {
        showToast({
          type: "error",
          message: "Add at least one item before checkout.",
        });
        return;
      }
      setIsCartOpen(false);
      setIsCheckoutOpen(true);
    } catch (error) {
      showToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to validate this cart with the server.",
      });
    }
  };

  const handleClearCart = (closeCheckout = false) => {
    if (cartInvoice?.items?.length) {
      setClearCartConfirmation({ closeCheckout });
      return false;
    }
    void cartActions.clearCart();
    return true;
  };

  const confirmClearCart = () => {
    const closeCheckout = Boolean(clearCartConfirmation?.closeCheckout);
    setClearCartConfirmation(null);
    void cartActions.clearCart();
    if (closeCheckout) setIsCheckoutOpen(false);
  };

  const handleHoldCart = async () => {
    setPageError(null);
    clearToast();
    if (!isReachable || navigator.onLine === false) {
      showToast({
        type: "error",
        message:
          "Holding invoices needs a connection - try again once you're back online.",
      });
      return;
    }
    try {
      const heldInvoice = await cartActions.holdCart();
      if (heldInvoice) {
        showToast({ type: "held", invoice: heldInvoice });
        void handleSelectCustomer(undefined, false);
        setIsCartOpen(false);
        return true;
      }
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to hold invoice",
      });
    }
    return false;
  };

  const handleRefreshHeld = async () => {
    setPageError(null);
    if (!isReachable || navigator.onLine === false) {
      showToast({
        type: "error",
        message:
          "Held invoices need a connection - try again once you're back online.",
      });
      return;
    }
    try {
      await cartActions.listHeld();
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to load held invoices",
      });
    }
  };

  useEffect(() => {
    if (activePage === "Invoices") {
      handleRefreshHeld();
    }
    // handleRefreshHeld is recreated every render (not memoized) - keying on
    // activePage alone is correct, it's the only thing this should react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  const handleRestoreHeld = async (heldInvoice: HeldInvoiceDTO) => {
    setPageError(null);
    clearToast();
    try {
      const restoredInvoice = await cartActions.restoreHeldInvoice(heldInvoice);
      void handleSelectCustomer(
        restoredInvoice.customer
          ? {
              customer: restoredInvoice.customer,
              customer_name:
                restoredInvoice.customer_name || restoredInvoice.customer,
            }
          : null,
        false,
      );
      setActivePage("Home");
      setIsCartOpen(true);
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to restore held invoice",
      });
    }
  };

  const handleCheckout = async (
    payments: PaymentInput[],
    idempotencyKey: string,
    isCreditSale: boolean,
    dueDate?: string,
    loyaltyPoints?: number,
    taxId?: string,
  ) => {
    setPageError(null);
    if (!isReachable || navigator.onLine === false) {
      showToast({
        type: "error",
        message:
          "VunaPOS is online-only. Reconnect before completing this sale.",
      });
      return;
    }
    try {
      const result = await cartActions.submitCart(
        payments,
        bootstrap.data?.print_format,
        idempotencyKey,
        true,
        isCreditSale,
        dueDate,
        loyaltyPoints,
        taxId,
        orderType,
        salesperson?.name,
        salesperson?.token,
      );
      setIsCheckoutOpen(false);
      if (bootstrap.data?.require_pin_before_every_sale) {
        onLockSalesperson?.();
      }
      void handleSelectCustomer(undefined, false);
      if (result?.invoice) {
        const queued =
          result.invoice.queue_status === "Queued" ||
          result.invoice.queue_status === "Processing";
        if (queued && bootstrap.data?.pos_profile) {
          // Reservations are created before the queue response is returned. Refresh
          // immediately so the catalogue shows sellable stock (physical minus
          // active reservations) without waiting for final invoice submission.
          try {
            await hydrate(bootstrap.data.pos_profile);
          } catch (refreshError) {
            console.error(
              "Unable to refresh stock after queued checkout",
              refreshError,
            );
          }
        }
        customerLoyalty.refresh();
        showToast({
          type: queued ? "queued" : "submitted",
          invoice: result.invoice,
        });
      } else {
        clearToast();
      }
      if (result?.printPayload) {
        printInvoiceHtml(result.printPayload);
      }
    } catch (err) {
      customerLoyalty.refresh();
      if (
        err instanceof VunaApiError &&
        ["PIN_TOKEN_INVALID", "PIN_TOKEN_REQUIRED", "SALESPERSON_REQUIRED"].includes(
          err.code || "",
        )
      ) {
        setIsCheckoutOpen(false);
        onLockSalesperson?.();
        showToast({
          type: "info",
          message: "Your salesperson PIN session expired. Verify your PIN to continue.",
        });
        return;
      }
      showToast({ type: "error", message: getCheckoutErrorMessage(err) });
    }
  };

  if (bootstrap.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm font-medium text-on-surface-variant">
          Loading POS workspace...
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      {error ? (
        <div className="mx-4 mb-3 mt-4 shrink-0 rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container">
          {error}
        </div>
      ) : null}

      {activePage === "Invoices" ? (
        getInvoiceFromPath(currentPath) ? (
          <InvoiceDetailsPage
            invoice={getInvoiceFromPath(currentPath) || ""}
            invoiceDoctype={getInvoiceDoctypeFromPath(currentPath)}
            posProfile={bootstrap.data?.pos_profile}
            isOnline={isReachable && navigator.onLine !== false}
            onStartSale={(customer) => {
              void handleSelectCustomer(customer);
              navigateToPosPage("Home");
            }}
          />
        ) : (
          <InvoicesPage
            posProfile={bootstrap.data?.pos_profile}
            currency={bootstrap.data?.currency}
            paymentModes={paymentModes}
            heldInvoices={heldInvoicesView}
            heldLoading={cartIsHeldLoading}
            onBack={() => setActivePage("Home")}
            onRefreshHeld={handleRefreshHeld}
            onRestoreHeld={handleRestoreHeld}
          />
        )
      ) : activePage === "Payments" ? (
        allowCustomerPayments ? (
          <PaymentsPage
            allowHistory={bootstrap.data?.allow_payment_history !== false}
            allowReceive={allowCustomerPayments}
            allowReconciliation={
              bootstrap.data?.allow_payment_reconciliation !== false
            }
            posProfile={bootstrap.data?.pos_profile}
            currency={bootstrap.data?.currency}
            paymentModes={paymentModes}
            isOnline={isReachable && navigator.onLine !== false}
          />
        ) : (
          <FeatureDisabled
            title="Payments disabled"
            message="Customer payments are disabled for this POS Profile."
          />
        )
      ) : activePage === "Customers" ? (
        allowCustomerManagement ? (
          getCustomerFromPath(currentPath) ? (
            <CustomerDetailsPage
              customer={getCustomerFromPath(currentPath) || ""}
              posProfile={bootstrap.data?.pos_profile}
              onStartSale={(customer) => {
                void handleSelectCustomer(customer);
                navigateToPosPage("Home");
              }}
            />
          ) : (
            <CustomersPage
              posProfile={bootstrap.data?.pos_profile}
              defaultCurrency={bootstrap.data?.currency}
            />
          )
        ) : (
          <FeatureDisabled
            title="Customer management disabled"
            message="Customer management is disabled for this POS Profile."
          />
        )
      ) : activePage === "Close Shift" ? (
        bootstrap.data?.pos_profile ? (
          <CloseShiftPage
            currency={bootstrap.data.currency}
            posProfile={bootstrap.data.pos_profile}
            onBack={() => navigateToPosPage("Home")}
          />
        ) : (
          <section className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-on-surface-variant">
              Loading the POS Profile for shift closing...
            </p>
          </section>
        )
      ) : activePage === "Profile" ? (
        <UserProfilePage bootstrap={bootstrap.data} />
      ) : (
        <div className="grid min-h-0 flex-1 overflow-hidden border-t border-outline-variant bg-surface pb-[68px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_clamp(32rem,32vw,38rem)]">
          <section className="flex min-w-0 min-h-0 flex-col p-4">
            <ItemSearch
              isLoading={items.isLoading}
              value={itemSearchQuery}
              onChange={setItemSearchQuery}
              onScan={handleScanBarcode}
              onOpenCamera={() => setIsBarcodeScannerOpen(true)}
            />
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              <ItemGrid
                currency={bootstrap.data?.currency}
                hideImages={bootstrap.data?.hide_images}
                isLoading={items.isLoading}
                items={items.items}
                pendingItemCode={pendingItemCode}
                onAddItem={handleAddItem}
              />
            </div>
          </section>
          <CartPanel
            allowCustomerCreation={allowCustomerCreation}
            allowPriceListSwitching={bootstrap.data?.allow_price_list_switching}
            allowedPriceLists={bootstrap.data?.allowed_price_lists}
            className="hidden xl:flex"
            allowDiscountChange={bootstrap.data?.allow_discount_change}
            allowRateChange={bootstrap.data?.allow_rate_change}
            currency={bootstrap.data?.currency}
            customerLoyalty={customerLoyalty.data}
            customerLoyaltyError={customerLoyalty.error}
            isCustomerLoyaltyLoading={customerLoyalty.isLoading}
            defaultPriceList={
              activeCustomer?.default_price_list ||
              (!selectedPriceList
                ? cartInvoice?.selling_price_list
                : undefined) ||
              bootstrap.data?.price_list
            }
            warehouse={bootstrap.data?.warehouse}
            isOnline={isReachable && navigator.onLine !== false}
            onCheckout={handleOpenCheckout}
            onClearCustomer={() => void handleSelectCustomer(null)}
            onClearCart={() => handleClearCart(false)}
            onHold={handleHoldCart}
            onLoadBatches={cartActions.loadItemBatches}
            onRemoveItem={handleRemoveItem}
            onSelectCustomer={(customer) => void handleSelectCustomer(customer)}
            onSelectPriceList={(priceList) =>
              void handleSelectPriceList(priceList)
            }
            posProfile={bootstrap.data?.pos_profile}
            selectedPriceList={selectedPriceList}
            onUpdateQty={cartActions.updateCartItemQty}
            onUpdatePricing={cartActions.updateCartItemPricing}
            onUpdateNote={cartActions.updateCartItemNote}
            onUpdateBatchAllocations={
              cartActions.updateCartItemBatchAllocations
            }
            onUpdateUom={cartActions.updateCartItemUom}
            onUpdateSerialAllocations={
              cartActions.updateCartItemSerialAllocations
            }
          />
        </div>
      )}

      {activePage === "Home" ? (
        <button
          type="button"
          className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-md xl:hidden"
          onClick={() => setIsCartOpen(true)}
          aria-label="Open cart"
        >
          <ShoppingCart className="size-6" />
          {cartQuantity > 0 ? (
            <span className="absolute -right-1 -top-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-error px-1 text-xs font-semibold text-on-error">
              {cartQuantity}
            </span>
          ) : null}
        </button>
      ) : null}

      {isCartOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsCartOpen(false)}
            aria-label="Close cart"
          />
          <div className="absolute bottom-0 right-0 top-0 flex w-[min(92vw,32rem)] flex-col border-l border-outline-variant bg-surface shadow-lg">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-outline-variant px-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <ShoppingCart className="size-4 text-primary" />
                Cart
              </div>
              <button
                type="button"
                className="flex h-touch w-touch items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                onClick={() => setIsCartOpen(false)}
                aria-label="Close cart"
              >
                <X className="size-5" />
              </button>
            </div>
            <CartPanel
              allowCustomerCreation={allowCustomerCreation}
              allowPriceListSwitching={
                bootstrap.data?.allow_price_list_switching
              }
              allowedPriceLists={bootstrap.data?.allowed_price_lists}
              className="flex-1 border-0"
              allowDiscountChange={bootstrap.data?.allow_discount_change}
              allowRateChange={bootstrap.data?.allow_rate_change}
              currency={bootstrap.data?.currency}
              customerLoyalty={customerLoyalty.data}
              customerLoyaltyError={customerLoyalty.error}
              isCustomerLoyaltyLoading={customerLoyalty.isLoading}
              defaultPriceList={
                activeCustomer?.default_price_list ||
                (!selectedPriceList
                  ? cartInvoice?.selling_price_list
                  : undefined) ||
                bootstrap.data?.price_list
              }
              warehouse={bootstrap.data?.warehouse}
              isOnline={isReachable && navigator.onLine !== false}
              onCheckout={handleOpenCheckout}
              onClearCustomer={() => void handleSelectCustomer(null)}
              onClearCart={() => handleClearCart(false)}
              onHold={handleHoldCart}
              onLoadBatches={cartActions.loadItemBatches}
              onRemoveItem={handleRemoveItem}
              onSelectCustomer={(customer) =>
                void handleSelectCustomer(customer)
              }
              onSelectPriceList={(priceList) =>
                void handleSelectPriceList(priceList)
              }
              posProfile={bootstrap.data?.pos_profile}
              selectedPriceList={selectedPriceList}
              onUpdateQty={cartActions.updateCartItemQty}
              onUpdatePricing={cartActions.updateCartItemPricing}
              onUpdateNote={cartActions.updateCartItemNote}
              onUpdateBatchAllocations={
                cartActions.updateCartItemBatchAllocations
              }
              onUpdateUom={cartActions.updateCartItemUom}
              onUpdateSerialAllocations={
                cartActions.updateCartItemSerialAllocations
              }
            />
          </div>
        </div>
      ) : null}

      <CheckoutDialog
        allowSalesOrderPayments={bootstrap.data?.allow_sales_order_payments}
        allowCreditSales={bootstrap.data?.allow_credit_sales}
        allowPartialPayment={bootstrap.data?.allow_partial_payment}
		    autoAllocatePaymentBalance={bootstrap.data?.auto_allocate_payment_balance}
        allowDeliveryCharges={bootstrap.data?.allow_delivery_charges}
        allowDeliveryChargeChange={bootstrap.data?.allow_delivery_charge_change}
        deliveryChargeItem={bootstrap.data?.delivery_charge_item}
        currency={bootstrap.data?.currency}
        currencyPrecision={bootstrap.data?.currency_precision}
        customer={activeCustomer}
        defaultSaleType={bootstrap.data?.default_sale_type}
        error={pageError}
        isOpen={isCheckoutOpen}
        modesOfPayment={paymentModes}
        customerLoyalty={customerLoyalty.data}
        onClear={() => {
          if (handleClearCart(true)) setIsCheckoutOpen(false);
        }}
        onApplyDeliveryCharge={applyDeliveryCharge}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirm={handleCheckout}
        onHold={() => {
          void handleHoldCart().then((held) => {
            if (held) setIsCheckoutOpen(false);
          });
        }}
        onAttachC2bGatewayPayment={(params) =>
          gatewayPayments.attachC2bPayment({
            ...params,
            pos_profile: bootstrap.data?.pos_profile,
            customer: activeCustomer?.customer,
            currency: bootstrap.data?.currency,
          })
        }
        onSearchC2bGatewayPayments={(params) =>
          gatewayPayments.searchC2bPayments({
            ...params,
            pos_profile: bootstrap.data?.pos_profile,
            customer: activeCustomer?.customer,
            currency: bootstrap.data?.currency,
          })
        }
        onCheckGatewayPayment={gatewayPayments.getGatewayPaymentStatus}
        onResolveCustomerPhone={gatewayPayments.getCustomerContactPhone}
        onCancelGatewayPayment={gatewayPayments.cancelGatewayPaymentLink}
        onInitiateGatewayPayment={(params) =>
          gatewayPayments.initiateStkPayment({
            ...params,
            pos_profile: bootstrap.data?.pos_profile,
            customer: activeCustomer?.customer,
            currency: bootstrap.data?.currency,
          })
        }
        onPreviewLoyalty={(points) =>
          cartActions.previewLoyaltyRedemption(points)
        }
        orderType={orderType}
        posProfile={bootstrap.data?.pos_profile}
      />

      <ManagerPinDialog
        isOpen={Boolean(managerPinTarget)}
        posProfile={bootstrap.data?.pos_profile}
        onCancel={() => setManagerPinTarget(null)}
        onApproved={(managerPinToken) => {
          const rowName = managerPinTarget;
          setManagerPinTarget(null);
          if (rowName) {
            void cartActions.removeCartItem(rowName, managerPinToken).catch((reason: unknown) => {
              showToast({
                type: "error",
                message: reason instanceof Error ? reason.message : "Unable to remove item.",
              });
            });
          }
        }}
      />

      <SalespersonPinLock
        enabled={Boolean(bootstrap.data?.enable_salesperson_pin && salespersonLocked)}
        posProfile={bootstrap.data?.pos_profile}
        pinUsers={bootstrap.data?.pin_users}
			onVerified={(name, displayName, token, expiresIn) => {
				onSalespersonVerified?.({ name, displayName, token, expiresIn });
          showToast({ type: "info", message: `${displayName} is ready to sell.` });
        }}
      />

      {toast?.type === "queued" ? (
        <div
          role="status"
          className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-secondary bg-secondary-container px-4 py-3 text-sm text-on-secondary-container shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
        >
          Invoice {toast.invoice.name} queued successfully.
        </div>
      ) : toast?.type === "submitted" && toast.invoice.docstatus === 1 ? (
        <div
          role="status"
          className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-secondary bg-secondary-container px-4 py-3 text-sm text-on-secondary-container shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
        >
          {toast.invoice.doctype === "Sales Order" ? "Sales Order" : "Invoice"}{" "}
          {toast.invoice.name} submitted for{" "}
          {getInvoiceTotal(toast.invoice).toFixed(2)}
          {toast.invoice.is_credit_sale
            ? ` as a credit sale${toast.invoice.due_date ? ` due ${toast.invoice.due_date}` : ""}.`
            : "."}
        </div>
      ) : null}

      {toast?.type === "held" && toast.invoice.docstatus === 0 ? (
        <div
          role="status"
          className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
        >
          Invoice {toast.invoice.name} held as draft.
        </div>
      ) : null}

      {toast?.type === "info" ? (
        <div
          role="status"
          className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-primary bg-primary-container px-4 py-3 text-sm text-on-primary-container shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
        >
          {toast.message}
        </div>
      ) : null}

      {toast?.type === "error" ? (
        <div
          role="alert"
          className={`fixed inset-x-0 top-4 z-[60] mx-auto flex w-[calc(100%-2rem)] max-w-sm items-start gap-3 rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 hover:bg-error/10"
            onClick={clearToast}
            aria-label="Dismiss error"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(clearCartConfirmation)}
        title="Clear the current cart?"
        description="Every item, quantity, payment allocation, batch or serial selection, discount, and note in this cart will be removed."
        confirmLabel="Clear Cart"
        danger
        onCancel={() => setClearCartConfirmation(null)}
        onConfirm={confirmClearCart}
      >
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-on-surface-variant">Items in cart</span>
          <strong>{cartInvoice?.items?.length || 0}</strong>
        </div>
      </ConfirmDialog>
      <VariantPickerDialog
        key={variantPickerItem?.item_code || "variant-picker"}
        currency={bootstrap.data?.currency}
        error={variantError}
        isLoading={templateVariantsCall.loading}
        isOpen={Boolean(variantPickerItem)}
        template={variantPickerItem}
        variants={variantOptions}
        onClose={() => {
          setVariantPickerItem(null);
          setVariantOptions([]);
          setVariantError(null);
        }}
        onSelect={handleSelectVariant}
      />
      <ProductBundleDialog
        key={bundleItem?.item_code || "product-bundle"}
        bundle={bundleItem}
        currency={bootstrap.data?.currency}
        details={bundleDetails}
        error={bundleError}
        isLoading={productBundleCall.loading}
        isOpen={Boolean(bundleItem)}
        onClose={() => {
          setBundleItem(null);
          setBundleDetails(null);
          setBundleError(null);
        }}
        onConfirm={() => {
          if (!bundleItem) return;
          setBundleItem(null);
          setBundleDetails(null);
          setBundleError(null);
          void addConcreteItem(bundleItem);
        }}
      />
      <BarcodeScannerDialog
        open={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        onDetected={handleScanBarcode}
      />
    </div>
  );
}
