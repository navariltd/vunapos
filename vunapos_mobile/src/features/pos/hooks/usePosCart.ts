import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCartData, PosCartItem, PosCatalogueItem, PosSaleCustomer } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

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
};

type CartResponse = Omit<PosCartData, 'items'> & {
  items: (Omit<PosCartItem, 'available_qty'> & { actual_qty?: number | null })[];
};

function toCartPayload(items: PosCartItem[]) {
  return items.map((item) => ({ item_code: item.item_code, qty: item.qty, uom: item.uom || undefined }));
}

function localCart(items: PosCartItem[]): PosCartData {
  const netTotal = items.reduce((total, item) => total + (item.qty * item.rate), 0);
  return { items, taxes: [], totals: { grand_total: netTotal, net_total: netTotal } };
}

function cartFromResponse(data: CartResponse, previousItems: PosCartItem[]): PosCartData {
  const previousByCode = new Map(previousItems.map((item) => [item.item_code, item]));
  return {
    ...data,
    items: data.items.map((item) => {
      const previous = previousByCode.get(item.item_code);
      return {
        ...item,
        allow_negative_stock: Boolean(item.allow_negative_stock),
        available_qty: item.actual_qty ?? previous?.available_qty ?? null,
        is_stock_item: Boolean(item.is_stock_item),
        rate: Number(item.rate || 0),
      };
    }),
  };
}

/** Session-only cart state calculated by Frappe after each cart change. */
export function usePosCart({ customer, posProfile }: UsePosCartArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [data, setData] = useState<PosCartData>({ items: [], taxes: [], totals: {} });
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const requestNumber = useRef(0);
  const attemptedItemsRef = useRef<PosCartItem[]>([]);
  const attemptedCustomerRef = useRef<PosSaleCustomer | null>(customer);
  const dataRef = useRef(data);
  const itemsRef = useRef(data.items);
  const customerRef = useRef(customer);
  const customerKey = customer?.customer || '';

  useEffect(() => {
    itemsRef.current = data.items;
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    customerRef.current = customer;
  }, [customer]);

  const refresh = useCallback(async (nextItems = itemsRef.current, cartCustomer = customerRef.current): Promise<PosCartData | null> => {
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
      setError('Your POS session is not ready. Try again once the workspace has loaded.');
      return null;
    }

    const request = ++requestNumber.current;
    attemptedItemsRef.current = nextItems;
    attemptedCustomerRef.current = cartCustomer;
    itemsRef.current = nextItems;
    setError(null);
    setIsUpdating(true);
    try {
      const response = await getVunaMethod<CartResponse>(companyUrl, sessionId, 'vunapos.api.sales.preview_invoice', {
        customer: cartCustomer?.customer || undefined,
        items: JSON.stringify(toCartPayload(nextItems)),
        pos_profile: posProfile,
      });
      const nextData = cartFromResponse(response, nextItems);
      if (request === requestNumber.current) {
        itemsRef.current = nextData.items;
        dataRef.current = nextData;
        setData(nextData);
      }
      return nextData;
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        void invalidateSession();
      }
      if (request === requestNumber.current) {
        itemsRef.current = dataRef.current.items;
        setError(requestError instanceof Error ? requestError.message : 'Could not update the cart.');
      }
      return null;
    } finally {
      if (request === requestNumber.current) setIsUpdating(false);
    }
  }, [companyUrl, invalidateSession, posProfile, sessionId]);

  useEffect(() => {
    if (itemsRef.current.length) void refresh(itemsRef.current, customerRef.current);
  }, [customerKey, refresh]);

  async function add(item: PosCatalogueItem, cartCustomer = customerRef.current) {
    const current = itemsRef.current;
    const existing = current.find((cartItem) => cartItem.item_code === item.item_code);
    const nextItems = existing
      ? current.map((cartItem) => cartItem.item_code === item.item_code ? { ...cartItem, qty: cartItem.qty + 1 } : cartItem)
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
    await refresh(itemsRef.current.filter((item) => item.item_code !== itemCode));
  }

  async function updateQuantity(itemCode: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    const nextItems = itemsRef.current.flatMap((item) => {
      if (item.item_code !== itemCode) return [item];
      return quantity > 0 ? [{ ...item, qty: quantity }] : [];
    });
    await refresh(nextItems);
  }

  async function retry() {
    await refresh(attemptedItemsRef.current, attemptedCustomerRef.current);
  }

  const itemCount = useMemo(() => data.items.reduce((total, item) => total + item.qty, 0), [data.items]);
  const subtotal = data.totals.net_total ?? data.items.reduce((total, item) => total + (item.qty * item.rate), 0);
  const requiresCustomer = Boolean(data.items.length && !customer);

  return { add, clear, error, itemCount, isUpdating, items: data.items, refresh, remove, requiresCustomer, retry, subtotal, taxes: data.taxes, totals: data.totals, updateQuantity };
}
