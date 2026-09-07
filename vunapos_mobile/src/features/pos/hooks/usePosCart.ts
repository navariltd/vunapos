import { useMemo, useState } from 'react';

import { PosCartItem, PosCatalogueItem } from '@/features/pos/types';

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

function maximumQuantity(item: PosCartItem) {
  return item.is_stock_item && !item.allow_negative_stock && item.available_qty !== null
    ? Math.max(item.available_qty, 0)
    : Number.POSITIVE_INFINITY;
}

function clampQuantity(item: PosCartItem, quantity: number) {
  return Math.min(Math.max(quantity, 0), maximumQuantity(item));
}

/** Session-only cart state. ERPNext revalidates stock and prices during checkout. */
export function usePosCart() {
  const [items, setItems] = useState<PosCartItem[]>([]);

  function add(item: PosCatalogueItem) {
    setItems((current) => {
      const index = current.findIndex((cartItem) => cartItem.item_code === item.item_code);
      if (index < 0) {
        const nextItem = toCartItem(item);
        return maximumQuantity(nextItem) < 1 ? current : [...current, nextItem];
      }

      const next = [...current];
      next[index] = { ...next[index], qty: clampQuantity(next[index], next[index].qty + 1) };
      return next;
    });
  }

  function clear() {
    setItems([]);
  }

  function remove(itemCode: string) {
    setItems((current) => current.filter((item) => item.item_code !== itemCode));
  }

  function updateQuantity(itemCode: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    setItems((current) => current.flatMap((item) => {
      if (item.item_code !== itemCode) return [item];
      const nextQuantity = clampQuantity(item, quantity);
      return nextQuantity > 0 ? [{ ...item, qty: nextQuantity }] : [];
    }));
  }

  const itemCount = useMemo(() => items.reduce((total, item) => total + item.qty, 0), [items]);
  const subtotal = useMemo(() => items.reduce((total, item) => total + (item.qty * item.rate), 0), [items]);

  return { add, clear, itemCount, items, remove, subtotal, updateQuantity };
}
