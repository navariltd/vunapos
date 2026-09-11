import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
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
} from "@/features/pos/types";
import {
  FrappeClientError,
  getVunaMethod,
  postVunaMethod,
} from "@/services/frappeClient";

function toCartItem(item: PosCatalogueItem): PosCartItem {
  return {
    allow_negative_stock: Boolean(item.allow_negative_stock),
    available_qty: item.actual_qty ?? null,
    is_stock_item: Boolean(item.is_stock_item),
    item_code: item.item_code,
    item_name: item.item_name,
    qty: 1,
    rate: Number(item.rate || 0),
    uom: item.stock_uom,
  };
}

type UsePosCartArgs = {
  customer: PosSaleCustomer | null;
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
        pricing_override: previous?.pricing_override,
        rate: Number(item.rate || 0),
      };
    }),
  };
}

/** Session-only cart state calculated by Frappe after each cart change. */
export function usePosCart({
  customer,
  posProfile,
  priceList,
}: UsePosCartArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
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
  const requestNumber = useRef(0);
  const attemptedItemsRef = useRef<PosCartItem[]>([]);
  const attemptedCustomerRef = useRef<PosSaleCustomer | null>(customer);
  const dataRef = useRef(data);
  const itemsRef = useRef(data.items);
  const customerRef = useRef(customer);
  const holdDraftRef = useRef<PosCheckoutResult | null>(null);
  const sourceInvoiceRef = useRef<PosCartSource | null>(null);
  const customerKey = customer?.customer || "";
  const priceListRef = useRef(priceList);
  const priceListKey = priceList || "";

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
      if (!nextItems.length) {
        const emptyCart = localCart([]);
        itemsRef.current = emptyCart.items;
        dataRef.current = emptyCart;
        setData(emptyCart);
        setError(null);
        return { items: [], taxes: [], totals: {} };
      }
      if (!cartCustomer) {
        const nextData = localCart(nextItems);
        itemsRef.current = nextData.items;
        dataRef.current = nextData;
        setData(nextData);
        setError(null);
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
            pos_profile: posProfile,
            price_list: cartPriceList,
          },
        );
        const nextData = cartFromResponse(response, nextItems);
        if (request === requestNumber.current) {
          itemsRef.current = nextData.items;
          dataRef.current = nextData;
          setData(nextData);
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
          itemsRef.current = dataRef.current.items;
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not update the cart.",
          );
        }
        return null;
      } finally {
        if (request === requestNumber.current) setIsUpdating(false);
      }
    },
    [companyUrl, invalidateSession, posProfile, sessionId],
  );

  useEffect(() => {
    if (itemsRef.current.length)
      void refresh(itemsRef.current, customerRef.current, priceListRef.current);
  }, [customerKey, priceListKey, refresh]);

  async function add(
    item: PosCatalogueItem,
    cartCustomer = customerRef.current,
  ) {
    const current = itemsRef.current;
    const existing = current.find(
      (cartItem) => cartItem.item_code === item.item_code,
    );
    const nextItems = existing
      ? current.map((cartItem) =>
          cartItem.item_code === item.item_code
            ? { ...cartItem, qty: cartItem.qty + 1 }
            : cartItem,
        )
      : [...current, toCartItem(item)];
    await refresh(nextItems, cartCustomer);
  }

  function clear() {
    requestNumber.current += 1;
    const emptyCart = { items: [], taxes: [], totals: {} };
    itemsRef.current = emptyCart.items;
    attemptedItemsRef.current = emptyCart.items;
    dataRef.current = emptyCart;
    holdDraftRef.current = null;
    sourceInvoiceRef.current = null;
    setData(emptyCart);
    setError(null);
    setHasPendingHold(false);
    setHoldError(null);
    setIsHolding(false);
    setIsUpdating(false);
    setSourceInvoice(null);
  }

  /** Restores a held Frappe draft into the editable cart without losing its server identity. */
  async function restoreHeldInvoice(
    heldInvoice: PosHeldInvoice,
  ): Promise<PosRestoredInvoice> {
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
    await refresh(
      itemsRef.current.filter((item) => item.item_code !== itemCode),
    );
  }

  async function updateQuantity(itemCode: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    const nextItems = itemsRef.current.flatMap((item) => {
      if (item.item_code !== itemCode) return [item];
      return quantity > 0 ? [{ ...item, qty: quantity }] : [];
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
          ? { ...item, pricing_override: undefined, uom }
          : item,
      ),
    );
  }

  /** Adds, updates, or removes the profile-configured delivery line through Frappe. */
  async function applyDeliveryCharge(
    itemCode: string,
    amount?: number,
  ): Promise<PosCartData | null> {
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
