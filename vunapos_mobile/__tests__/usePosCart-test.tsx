import { act, cleanup, renderHook } from '@testing-library/react-native';

import { usePosCart } from '@/features/pos/hooks/usePosCart';

describe('usePosCart', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('adds live catalogue items, caps stock quantities, and calculates the subtotal', async () => {
    const hook = await renderHook(() => usePosCart());
    const item = { actual_qty: 2, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', rate: 125, stock_uom: 'Nos' };

    await act(async () => {
      hook.result.current.add(item);
      hook.result.current.add(item);
      hook.result.current.add(item);
    });

    expect(hook.result.current.items).toEqual([expect.objectContaining({ item_code: 'ITEM-001', qty: 2, rate: 125 })]);
    expect(hook.result.current.itemCount).toBe(2);
    expect(hook.result.current.subtotal).toBe(250);
  });

  it('updates, removes, and clears cart lines without persisting them', async () => {
    const hook = await renderHook(() => usePosCart());
    const item = { actual_qty: 5, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', rate: 125, stock_uom: 'Nos' };

    await act(async () => hook.result.current.add(item));
    await act(async () => hook.result.current.updateQuantity('ITEM-001', 3));
    expect(hook.result.current.subtotal).toBe(375);

    await act(async () => hook.result.current.remove('ITEM-001'));
    expect(hook.result.current.items).toEqual([]);

    await act(async () => hook.result.current.add(item));
    await act(async () => hook.result.current.clear());
    expect(hook.result.current.items).toEqual([]);
  });
});
