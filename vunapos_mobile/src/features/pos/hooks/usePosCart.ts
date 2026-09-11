import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  PosCartData,
  PosCartItem,
  PosCatalogueItem,
  PosPricingOverride,
  PosSaleCustomer,
} from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

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

function toCartPayload(items: PosCartItem[]) {
  return items.map((item) => ({
    item_code: item.item_code,
    item_note: item.item_note || undefined,
    pricing_override: item.pricing_override,
    qty: item.qty,
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
  const [isUpdating, setIsUpdating] = useState(false);
  const requestNumber = useRef(0);
  const attemptedItemsRef = useRef<PosCartItem[]>([]);
  const attemptedCustomerRef = useRef<PosSaleCustomer | null>(customer);
  const dataRef = useRef(data);
  const itemsRef = useRef(data.items);
  const customerRef = useRef(customer);
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
    setData(emptyCart);
    setError(null);
    setIsUpdating(false);
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
    itemCount,
    isUpdating,
    items: data.items,
    refresh,
    remove,
    requiresCustomer,
    retry,
    subtotal,
    taxes: data.taxes,
    totals: data.totals,
    updateItemNote,
    updatePricing,
    updateQuantity,
    updateUom,
  };
}
