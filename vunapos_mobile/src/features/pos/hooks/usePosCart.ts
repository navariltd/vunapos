import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import {
  PosBatchAllocation,
  PosCartData,
  PosCartItem,
  PosCatalogueItem,
  PosCheckoutResult,
  PosPricingOverride,
  PosCartSource,
  PosHeldInvoice,
  PosRestoredInvoice,
  PosSerialAllocation,
  PosSaleCustomer,
  PosOrderType,
} from "@/features/pos/types";
import {
  FrappeClientError,
  getVunaMethod,
  postVunaMethod,
} from "@/services/frappeClient";
import { invalidateHeldInvoiceCache } from "@/services/posCacheInvalidation";
import { posCache, PosCacheScope } from "@/services/posCache";

const ACTIVE_CART_RESOURCE = "active-cart";
const ACTIVE_CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PersistedCart = {
  customer: PosSaleCustomer | null;
  data: PosCartData;
  priceList?: string;
  sourceInvoice: PosCartSource | null;
};

function selectAvailableInitialUom(item: PosCatalogueItem): {
  item: PosCatalogueItem;
  notice?: string;
} {
  const requestedUom = item.uom || item.stock_uom;
  const requestedFactor = Number(item.conversion_factor || 1);
  const available = Number(item.actual_qty);
  if (
    item.is_stock_item === false ||
    Boolean(item.allow_negative_stock) ||
    !Number.isFinite(available) ||
    !item.stock_uom ||
    !requestedUom ||
    requestedUom === item.stock_uom ||
    requestedFactor <= 1 ||
    available >= requestedFactor ||
    available < 1
  ) {
    return { item };
  }

  const stockUomRate = item.uoms?.find(
    (row) => row.uom === item.stock_uom,
  )?.rate;
  const rate =
    stockUomRate == null
      ? Number(item.rate || 0) / requestedFactor
      : Number(stockUomRate);
  const priceListRate =
    item.uoms?.find((row) => row.uom === item.stock_uom)?.rate ?? rate;
  return {
    item: {
      ...item,
      conversion_factor: 1,
      price_list_rate: Number(priceListRate),
      rate,
      uom: item.stock_uom,
    },
    notice: `Only ${available} ${item.stock_uom} available; 1 ${requestedUom} requires ${requestedFactor} ${item.stock_uom}. Added as ${item.stock_uom}.`,
  };
}

function toCartItem(item: PosCatalogueItem): PosCartItem {
  const rate = Number(item.rate || 0);
  const priceListRate = Number(item.price_list_rate ?? rate);
  return {
    allow_negative_stock: Boolean(item.allow_negative_stock),
    available_qty: item.actual_qty ?? null,
    catalogue_price_list_rate: priceListRate,
    catalogue_rate: rate,
    conversion_factor: Number(item.conversion_factor || 1),
    is_stock_item: Boolean(item.is_stock_item),
    item_code: item.item_code,
    item_name: item.item_name,
    price_list_rate: priceListRate,
    qty: 1,
    rate,
    uom: item.uom || item.stock_uom,
    uoms: item.uoms,
  };
}

type UsePosCartArgs = {
  customer: PosSaleCustomer | null;
  orderType?: PosOrderType;
  posProfile?: string;
  priceList?: string;
};

type CartResponse = Omit<PosCartData, "items"> & {
  items: (Omit<PosCartItem, "available_qty"> & {
    actual_qty?: number | null;
  })[];
};

type RestoredInvoiceResponse = CartResponse & {
  customer?: string;
  customer_name?: string;
  doctype: string;
  name: string;
  selling_price_list?: string;
};

function toCartPayload(items: PosCartItem[]) {
  return items.map((item) => ({
    batch_allocations: item.batch_allocations?.map((allocation) => ({
      batch_no: allocation.batch_no,
      qty: allocation.qty,
    })),
    item_code: item.item_code,
    item_note: item.item_note || undefined,
    pricing_override: item.pricing_override,
    qty: item.qty,
    serial_allocations: item.serial_allocations,
    uom: item.uom || undefined,
  }));
}

function localCart(items: PosCartItem[]): PosCartData {
  const netTotal = items.reduce(
    (total, item) => total + item.qty * item.rate,
    0,
  );
  return {
    items,
    taxes: [],
    totals: { grand_total: netTotal, net_total: netTotal },
  };
}

/**
 * Batch and serial selections describe an exact stock quantity. Any quantity
 * or UOM change invalidates that selection; leaving it attached makes the next
 * server preview reject an otherwise valid cart with a tracking mismatch.
 */
function clearTrackingAllocations(item: PosCartItem): PosCartItem {
  return {
    ...item,
    batch_allocations: undefined,
    serial_allocations: undefined,
  };
}

/** Restore catalogue pricing after removing a customer-specific price context. */
function restoreCataloguePricing(items: PosCartItem[]): PosCartItem[] {
  return items.map((item) => {
    if (item.pricing_override) return item;
    const rate = item.catalogue_rate ?? item.price_list_rate ?? item.rate;
    return {
      ...item,
      discount_amount: 0,
      discount_percentage: 0,
      price_list_rate:
        item.catalogue_price_list_rate ?? item.catalogue_rate ?? rate,
      pricing_rules: undefined,
      rate,
    };
  });
}

function cartFromResponse(
  data: CartResponse,
  previousItems: PosCartItem[],
): PosCartData {
  const previousByCode = new Map(
    previousItems.map((item) => [item.item_code, item]),
  );
  return {
    ...data,
    items: data.items.map((item) => {
      const previous = previousByCode.get(item.item_code);
      return {
        ...item,
        allow_negative_stock: Boolean(item.allow_negative_stock),
        available_qty: item.actual_qty ?? previous?.available_qty ?? null,
        is_stock_item: Boolean(item.is_stock_item),
        catalogue_price_list_rate:
          previous?.catalogue_price_list_rate ??
          previous?.price_list_rate ??
          Number(item.price_list_rate ?? item.rate ?? 0),
        catalogue_rate:
          previous?.catalogue_rate ??
          previous?.rate ??
          Number(item.price_list_rate ?? item.rate ?? 0),
        pricing_override: previous?.pricing_override,
        rate: Number(item.rate || 0),
      };
    }),
  };
}

/** Session-only cart state calculated by Frappe after each cart change. */
export function usePosCart({
  customer,
  orderType = "Invoice",
  posProfile,
  priceList,
}: UsePosCartArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const isOffline = connectionStatus !== "online";
  const [data, setData] = useState<PosCartData>({
    items: [],
    taxes: [],
    totals: {},
  });
  const [error, setError] = useState<string | null>(null);
  const [hasPendingHold, setHasPendingHold] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [isHolding, setIsHolding] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [sourceInvoice, setSourceInvoice] = useState<PosCartSource | null>(
    null,
  );
  const [restoredCustomer, setRestoredCustomer] =
    useState<PosSaleCustomer | null>(null);
  const [restoredPriceList, setRestoredPriceList] = useState<string>();
  const requestNumber = useRef(0);
  const attemptedItemsRef = useRef<PosCartItem[]>([]);
  const attemptedCustomerRef = useRef<PosSaleCustomer | null>(customer);
  const dataRef = useRef(data);
  const itemsRef = useRef(data.items);
  const customerRef = useRef(customer);
  const holdDraftRef = useRef<PosCheckoutResult | null>(null);
  const sourceInvoiceRef = useRef<PosCartSource | null>(null);
  const lastRefreshErrorRef = useRef<string | null>(null);
  const customerKey = customer?.customer || "";
  const priceListRef = useRef(priceList);
  const priceListKey = priceList || "";
  // Sales Orders must be previewed as Sales Orders. For invoices, leaving this
  // unset preserves the POS Settings-selected invoice doctype (Sales Invoice
  // or POS Invoice) on the server.
  const invoiceDoctype = orderType === "Order" ? "Sales Order" : undefined;
  const cartCacheScope = useMemo<PosCacheScope | null>(
    () =>
      companyUrl && posProfile && sessionId
        ? { companyUrl, posProfile, userId: sessionId }
        : null,
    [companyUrl, posProfile, sessionId],
  );
  const hydrationStartedRef = useRef<string | null>(null);
  const hydratedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    itemsRef.current = data.items;
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    customerRef.current = customer;
  }, [customer]);

  useEffect(() => {
    priceListRef.current = priceList;
  }, [priceList]);

  const refresh = useCallback(
    async (
      nextItems = itemsRef.current,
      cartCustomer = customerRef.current,
      cartPriceList = priceListRef.current,
    ): Promise<PosCartData | null> => {
      if (isOffline) {
        setError(
          "Connection unavailable. Reconnect before changing this cart.",
        );
        return null;
      }
      if (!nextItems.length) {
        const emptyCart = localCart([]);
        itemsRef.current = emptyCart.items;
        dataRef.current = emptyCart;
        setData(emptyCart);
        setError(null);
        lastRefreshErrorRef.current = null;
        return { items: [], taxes: [], totals: {} };
      }
      if (!cartCustomer) {
        const nextData = localCart(restoreCataloguePricing(nextItems));
        itemsRef.current = nextData.items;
        dataRef.current = nextData;
        setData(nextData);
        setError(null);
        lastRefreshErrorRef.current = null;
        setIsUpdating(false);
        return nextData;
      }
      if (!companyUrl || !sessionId || !posProfile) {
        setError(
          "Your POS session is not ready. Try again once the workspace has loaded.",
        );
        return null;
      }

      const request = ++requestNumber.current;
      if (!holdDraftRef.current) setHoldError(null);
      attemptedItemsRef.current = nextItems;
      attemptedCustomerRef.current = cartCustomer;
      itemsRef.current = nextItems;
      setError(null);
      setIsUpdating(true);
      try {
        const response = await getVunaMethod<CartResponse>(
          companyUrl,
          sessionId,
          "vunapos.api.sales.preview_invoice",
          {
            customer: cartCustomer?.customer || undefined,
            items: JSON.stringify(toCartPayload(nextItems)),
            ...(invoiceDoctype ? { invoice_doctype: invoiceDoctype } : {}),
            pos_profile: posProfile,
            price_list: cartPriceList,
          },
        );
        const nextData = cartFromResponse(response, nextItems);
        if (request === requestNumber.current) {
          itemsRef.current = nextData.items;
          dataRef.current = nextData;
          setData(nextData);
          lastRefreshErrorRef.current = null;
        }
        return nextData;
      } catch (requestError) {
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        ) {
          void invalidateSession();
        }
        if (request === requestNumber.current) {
          const message =
            requestError instanceof Error
              ? requestError.message
              : "Could not update the cart.";
          // A failed preview must never become the cart state or the retry
          // target. Keep the last server-approved cart and retry that state.
          const lastValidData = dataRef.current;
          itemsRef.current = lastValidData.items;
          attemptedItemsRef.current = lastValidData.items;
          attemptedCustomerRef.current = customerRef.current;
          setData(lastValidData);
          lastRefreshErrorRef.current = message;
          setError(message);
        }
        return null;
      } finally {
        if (request === requestNumber.current) setIsUpdating(false);
      }
    },
    [
      companyUrl,
      invalidateSession,
      invoiceDoctype,
      isOffline,
      posProfile,
      sessionId,
    ],
  );

  useEffect(() => {
    if (!cartCacheScope) return;
    const scopeKey = JSON.stringify(cartCacheScope);
    if (hydrationStartedRef.current === scopeKey) return;
    hydrationStartedRef.current = scopeKey;
    let cancelled = false;
    void posCache
      .read<PersistedCart>({
        resource: ACTIVE_CART_RESOURCE,
        scope: cartCacheScope,
      })
      .then((cached) => {
        if (cancelled) return;
        hydratedScopeRef.current = scopeKey;
        if (!cached?.data?.data?.items?.length) return;
        const draft = cached.data;
        itemsRef.current = draft.data.items;
        dataRef.current = draft.data;
        attemptedItemsRef.current = draft.data.items;
        attemptedCustomerRef.current = draft.customer;
        sourceInvoiceRef.current = draft.sourceInvoice;
        setData(draft.data);
        setSourceInvoice(draft.sourceInvoice);
        setRestoredCustomer(draft.customer);
        setRestoredPriceList(draft.priceList);
        if (!isOffline) {
          void refresh(draft.data.items, draft.customer, draft.priceList);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cartCacheScope, isOffline, refresh]);

  useEffect(() => {
    if (
      !cartCacheScope ||
      hydratedScopeRef.current !== JSON.stringify(cartCacheScope)
    )
      return;
    if (!data.items.length) {
      void posCache.clearResource(cartCacheScope, ACTIVE_CART_RESOURCE);
      return;
    }
    const draft: PersistedCart = {
      customer: customerRef.current,
      data,
      priceList: priceListRef.current,
      sourceInvoice: sourceInvoiceRef.current,
    };
    void posCache.write(
      { resource: ACTIVE_CART_RESOURCE, scope: cartCacheScope },
      draft,
      ACTIVE_CART_TTL_MS,
    );
  }, [cartCacheScope, customerKey, data, priceListKey]);

  useEffect(() => {
    if (itemsRef.current.length)
      void refresh(itemsRef.current, customerRef.current, priceListRef.current);
  }, [customerKey, priceListKey, refresh]);

  async function add(
    item: PosCatalogueItem,
    cartCustomer = customerRef.current,
  ): Promise<boolean | string> {
    const initialUom = selectAvailableInitialUom(item);
    const itemForCart = initialUom.item;
    const current = itemsRef.current;
    const existing = current.find(
      (cartItem) =>
        cartItem.item_code === itemForCart.item_code &&
        (cartItem.uom || cartItem.stock_uom) ===
          (itemForCart.uom || itemForCart.stock_uom) &&
        Number(cartItem.conversion_factor || 1) ===
          Number(itemForCart.conversion_factor || 1),
    );
    const nextItems = existing
      ? current.map((cartItem) =>
          cartItem.item_code === itemForCart.item_code &&
          (cartItem.uom || cartItem.stock_uom) ===
            (itemForCart.uom || itemForCart.stock_uom) &&
          Number(cartItem.conversion_factor || 1) ===
            Number(itemForCart.conversion_factor || 1)
            ? { ...clearTrackingAllocations(cartItem), qty: cartItem.qty + 1 }
            : cartItem,
        )
      : [...current, toCartItem(itemForCart)];
    const nextData = await refresh(nextItems, cartCustomer);
    if (nextData !== null) return initialUom.notice || true;
    const message = lastRefreshErrorRef.current;
    if (message) throw new Error(message);
    return false;
  }

  function clear() {
    if (isOffline) {
      setError("Connection unavailable. Reconnect before clearing this cart.");
      return false;
    }
    requestNumber.current += 1;
    const emptyCart = { items: [], taxes: [], totals: {} };
    itemsRef.current = emptyCart.items;
    attemptedItemsRef.current = emptyCart.items;
    dataRef.current = emptyCart;
    holdDraftRef.current = null;
    sourceInvoiceRef.current = null;
    setData(emptyCart);
    setError(null);
    lastRefreshErrorRef.current = null;
    setHasPendingHold(false);
    setHoldError(null);
    setIsHolding(false);
    setIsUpdating(false);
    setSourceInvoice(null);
    return true;
  }

  /** Restores a held Frappe draft into the editable cart without losing its server identity. */
  async function restoreHeldInvoice(
    heldInvoice: PosHeldInvoice,
  ): Promise<PosRestoredInvoice> {
    if (isOffline) {
      throw new Error(
        "Connection unavailable. Reconnect before restoring a held invoice.",
      );
    }
    if (!companyUrl || !sessionId || !posProfile) {
      throw new Error(
        "Your POS session is not ready. Try again once the workspace has loaded.",
      );
    }
    setError(null);
    setIsUpdating(true);
    try {
      const restored = await postVunaMethod<RestoredInvoiceResponse>(
        companyUrl,
        sessionId,
        "vunapos.api.sales.restore_invoice",
        {
          invoice_doctype: heldInvoice.doctype,
          invoice_name: heldInvoice.name,
        },
      );
      const restoredItems = restored.items.map((item) => ({
        ...item,
        allow_negative_stock: Boolean(item.allow_negative_stock),
        available_qty: item.actual_qty ?? null,
        is_stock_item: Boolean(item.is_stock_item),
        rate: Number(item.rate || 0),
      }));
      const nextData = cartFromResponse(restored, restoredItems);
      const source = { doctype: restored.doctype, name: restored.name };
      itemsRef.current = nextData.items;
      dataRef.current = nextData;
      sourceInvoiceRef.current = source;
      setData(nextData);
      setSourceInvoice(source);
      await invalidateHeldInvoiceCache({ companyUrl, posProfile, sessionId });
      return {
        ...nextData,
        customer: restored.customer,
        customer_name: restored.customer_name,
        selling_price_list: restored.selling_price_list,
        source,
      };
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
      }
      throw requestError;
    } finally {
      setIsUpdating(false);
    }
  }

  /** Creates and immediately holds an online Frappe draft, retaining it for a safe retry if holding fails. */
  async function hold(): Promise<PosCheckoutResult | null> {
    if (isOffline) {
      setHoldError("Connection unavailable. Reconnect before holding this cart.");
      return null;
    }
    const cartItems = itemsRef.current;
    if (!cartItems.length) {
      setHoldError("Add an item before holding this cart.");
      return null;
    }
    if (!companyUrl || !sessionId || !posProfile) {
      setHoldError(
        "Your POS session is not ready. Try again once the workspace has loaded.",
      );
      return null;
    }

    setHoldError(null);
    setIsHolding(true);
    try {
      let draft = holdDraftRef.current;
      if (!draft) {
        const source = sourceInvoiceRef.current;
        draft = source
          ? await postVunaMethod<PosCheckoutResult>(
              companyUrl,
              sessionId,
              "vunapos.api.sales.update_invoice_from_cart",
              {
                customer: customerRef.current?.customer,
                invoice_doctype: source.doctype,
                invoice_name: source.name,
                items: JSON.stringify(toCartPayload(cartItems)),
                price_list: priceListRef.current,
              },
            )
          : await postVunaMethod<PosCheckoutResult>(
              companyUrl,
              sessionId,
              "vunapos.api.sales.create_invoice_from_cart",
              {
                customer: customerRef.current?.customer,
                items: JSON.stringify(toCartPayload(cartItems)),
                pos_profile: posProfile,
                price_list: priceListRef.current,
              },
            );
        holdDraftRef.current = draft;
        setHasPendingHold(true);
      }

      const heldInvoice = await postVunaMethod<PosCheckoutResult>(
        companyUrl,
        sessionId,
        "vunapos.api.sales.hold_invoice",
        {
          invoice_doctype: draft.doctype,
          invoice_name: draft.name,
        },
      );
      await invalidateHeldInvoiceCache({ companyUrl, posProfile, sessionId });
      clear();
      return heldInvoice;
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
      }
      setHoldError(
        requestError instanceof Error
          ? requestError.message
          : "Could not hold this cart.",
      );
      return null;
    } finally {
      setIsHolding(false);
    }
  }

  async function remove(itemCode: string) {
    return (
      (await refresh(
      itemsRef.current.filter((item) => item.item_code !== itemCode),
      )) !== null
    );
  }

  async function updateQuantity(itemCode: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    const nextItems = itemsRef.current.flatMap((item) => {
      if (item.item_code !== itemCode) return [item];
      if (quantity <= 0) return [];
      return [
        quantity === item.qty
          ? item
          : { ...clearTrackingAllocations(item), qty: quantity },
      ];
    });
    await refresh(nextItems);
  }

  /** Stores a concise packing, handling, or cashier note with its cart item. */
  async function updateItemNote(itemCode: string, note: string) {
    const cleanNote = note.trim();
    if (cleanNote.length > 500) {
      setError("Item notes cannot exceed 500 characters.");
      return null;
    }
    return refresh(
      itemsRef.current.map((item) =>
        item.item_code === itemCode
          ? { ...item, item_note: cleanNote || null }
          : item,
      ),
    );
  }

  /** Sends a manual batch split to Frappe, which verifies it against live stock. */
  async function updateBatchAllocations(
    itemCode: string,
    allocations: PosBatchAllocation[],
  ) {
    return refresh(
      itemsRef.current.map((item) =>
        item.item_code === itemCode
          ? { ...item, batch_allocations: allocations }
          : item,
      ),
    );
  }

  /** Sends an exact serial selection to Frappe for live warehouse validation. */
  async function updateSerialAllocations(
    itemCode: string,
    allocations: PosSerialAllocation[],
  ) {
    return refresh(
      itemsRef.current.map((item) =>
        item.item_code === itemCode
          ? { ...item, serial_allocations: allocations }
          : item,
      ),
    );
  }

  /** Applies a permitted manual rate or discount before Frappe validates and audits it. */
  async function updatePricing(
    itemCode: string,
    pricingOverride?: PosPricingOverride,
  ) {
    if (
      pricingOverride &&
      (!Number.isFinite(pricingOverride.value) ||
        pricingOverride.value < 0 ||
        (pricingOverride.type === "discount_percentage" &&
          pricingOverride.value > 100))
    ) {
      setError("Enter a valid non-negative pricing value.");
      return null;
    }
    return refresh(
      itemsRef.current.map((item) => {
        if (item.item_code !== itemCode) return item;
        const priceListRate = item.price_list_rate ?? item.rate;
        if (!pricingOverride) {
          return {
            ...item,
            discount_amount: 0,
            discount_percentage: 0,
            pricing_override: undefined,
            rate: priceListRate,
          };
        }
        if (pricingOverride.type === "rate") {
          return {
            ...item,
            discount_amount: 0,
            discount_percentage: 0,
            pricing_override: pricingOverride,
            rate: pricingOverride.value,
          };
        }
        const discountAmount =
          pricingOverride.type === "discount_percentage"
            ? (priceListRate * pricingOverride.value) / 100
            : pricingOverride.value;
        return {
          ...item,
          discount_amount: discountAmount,
          discount_percentage:
            pricingOverride.type === "discount_percentage"
              ? pricingOverride.value
              : priceListRate
                ? (discountAmount / priceListRate) * 100
                : 0,
          pricing_override: pricingOverride,
          rate: Math.max(priceListRate - discountAmount, 0),
        };
      }),
    );
  }

  /** Changes to an Item-configured UOM only; Frappe recalculates its rate, tax, and stock quantities. */
  async function updateUom(itemCode: string, uom: string) {
    if (!uom) return;
    await refresh(
      itemsRef.current.map((item) =>
        item.item_code === itemCode
          ? {
              ...clearTrackingAllocations(item),
              pricing_override: undefined,
              uom,
            }
          : item,
      ),
    );
  }

  /** Adds, updates, or removes the profile-configured delivery line through Frappe. */
  async function applyDeliveryCharge(
    itemCode: string,
    amount?: number,
  ): Promise<PosCartData | null> {
    if (isOffline) {
      setError(
        "Connection unavailable. Reconnect before changing the delivery charge.",
      );
      return null;
    }
    if (amount === undefined || amount <= 0) {
      return refresh(
        itemsRef.current.filter((item) => item.item_code !== itemCode),
      );
    }
    if (!Number.isFinite(amount)) return null;

    const existing = itemsRef.current.find(
      (item) => item.item_code === itemCode,
    );
    if (existing) {
      return refresh(
        itemsRef.current.map((item) =>
          item.item_code === itemCode
            ? {
                ...item,
                pricing_override: { type: "rate", value: amount },
                qty: 1,
                rate: amount,
              }
            : item,
        ),
      );
    }
    if (!companyUrl || !sessionId || !posProfile) {
      setError(
        "Your POS session is not ready. Try again once the workspace has loaded.",
      );
      return null;
    }

    setError(null);
    setIsUpdating(true);
    try {
      const deliveryItem = await getVunaMethod<PosCatalogueItem>(
        companyUrl,
        sessionId,
        "vunapos.api.item.get_item_details",
        {
          customer: customerRef.current?.customer,
          item_code: itemCode,
          pos_profile: posProfile,
        },
      );
      return refresh([
        ...itemsRef.current,
        {
          ...toCartItem(deliveryItem),
          pricing_override: { type: "rate", value: amount },
          rate: amount,
        },
      ]);
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update the delivery charge.",
      );
      setIsUpdating(false);
      return null;
    }
  }

  async function retry() {
    await refresh(attemptedItemsRef.current, attemptedCustomerRef.current);
  }

  const itemCount = useMemo(
    () => data.items.reduce((total, item) => total + item.qty, 0),
    [data.items],
  );
  const subtotal =
    data.totals.net_total ??
    data.items.reduce((total, item) => total + item.qty * item.rate, 0);
  const requiresCustomer = Boolean(data.items.length && !customer);

  return {
    add,
    applyDeliveryCharge,
    clear,
    error,
    hasPendingHold,
    hold,
    holdError,
    itemCount,
    isHolding,
    isUpdating,
    items: data.items,
    refresh,
    restoredCustomer,
    restoredPriceList,
    remove,
    restoreHeldInvoice,
    requiresCustomer,
    retry,
    subtotal,
    sourceInvoice,
    taxes: data.taxes,
    totals: data.totals,
    updateBatchAllocations,
    updateItemNote,
    updatePricing,
    updateQuantity,
    updateSerialAllocations,
    updateUom,
  };
}
