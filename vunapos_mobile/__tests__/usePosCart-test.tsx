import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosCart } from '@/features/pos/hooks/usePosCart';
import { PosSaleCustomer } from '@/features/pos/types';
import { getVunaMethod } from '@/services/frappeClient';

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();
const item = { actual_qty: 5, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', rate: 125, stock_uom: 'Nos' };

describe('usePosCart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession, sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
    mockGetVunaMethod.mockImplementation(async (_companyUrl, _sessionId, _method, params) => {
      const cartItems = String(params?.items ?? '');
      const isQuantityThree = cartItems.includes('"qty":3');
      return {
        items: [{ actual_qty: 4, allow_negative_stock: false, amount: isQuantityThree ? 375 : 125, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: isQuantityThree ? 3 : 1, rate: 125, uom: 'Nos' }],
        taxes: [{ description: 'VAT', tax_amount: isQuantityThree ? 60 : 20 }],
        totals: { grand_total: isQuantityThree ? 435 : 145, net_total: isQuantityThree ? 375 : 125 },
      };
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('adds catalogue items through Frappe and uses its calculated item and total values', async () => {
    const hook = await renderHook(() => usePosCart({ customer: { customer: 'CUST-001', customerName: 'Example customer' }, posProfile: 'POS-001' }));

    await act(async () => { await hook.result.current.add(item); });

    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.preview_invoice', {
      customer: 'CUST-001',
      items: '[{"item_code":"ITEM-001","qty":1,"uom":"Nos"}]',
      pos_profile: 'POS-001',
    });
    expect(hook.result.current.items).toEqual([expect.objectContaining({ amount: 125, available_qty: 4, item_code: 'ITEM-001', qty: 1 })]);
    expect(hook.result.current.subtotal).toBe(125);
    expect(hook.result.current.taxes).toEqual([{ description: 'VAT', tax_amount: 20 }]);
  });

  it('keeps a temporary cart until a customer is selected, then refreshes it with Frappe', async () => {
    const hook = await renderHook<ReturnType<typeof usePosCart>, { customer: PosSaleCustomer | null }>(
      ({ customer }) => usePosCart({ customer, posProfile: 'POS-001' }),
      { initialProps: { customer: null } },
    );

    await act(async () => hook.result.current.add(item));
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.items).toEqual([expect.objectContaining({ item_code: 'ITEM-001', qty: 1 })]);
    expect(hook.result.current.subtotal).toBe(125);
    expect(hook.result.current.requiresCustomer).toBe(true);

    await hook.rerender({ customer: { customer: 'CUST-001', customerName: 'Example customer' } });
    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.preview_invoice', expect.objectContaining({ customer: 'CUST-001' })));
    expect(hook.result.current.requiresCustomer).toBe(false);

    await act(async () => hook.result.current.updateQuantity('ITEM-001', 3));
    expect(hook.result.current.subtotal).toBe(375);
    expect(mockGetVunaMethod).toHaveBeenLastCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.preview_invoice', expect.objectContaining({ items: '[{"item_code":"ITEM-001","qty":3,"uom":"Nos"}]' }));

    await act(async () => hook.result.current.remove('ITEM-001'));
    expect(hook.result.current.items).toEqual([]);

    await act(async () => hook.result.current.add(item));
    await act(async () => hook.result.current.clear());
    expect(hook.result.current.items).toEqual([]);
  });

  it('keeps the last successful cart visible when Frappe cannot update it', async () => {
    const hook = await renderHook(() => usePosCart({ customer: { customer: 'CUST-001', customerName: 'Example customer' }, posProfile: 'POS-001' }));
    await act(async () => hook.result.current.add(item));
    mockGetVunaMethod.mockRejectedValueOnce(new Error('Network error'));

    await act(async () => hook.result.current.updateQuantity('ITEM-001', 2));

    await waitFor(() => expect(hook.result.current.error).toBe('Network error'));
    expect(hook.result.current.items).toEqual([expect.objectContaining({ qty: 1 })]);
  });

  it('adds the configured delivery item with its server-approved rate override', async () => {
    mockGetVunaMethod.mockImplementation(async (_companyUrl, _sessionId, method, params) => {
      if (method === 'vunapos.api.item.get_item_details') {
        return { actual_qty: null, is_stock_item: false, item_code: 'DELIVERY', item_name: 'Delivery charge', rate: 0, stock_uom: 'Nos' };
      }
      const cartItems = JSON.parse(String(params?.items ?? '[]'));
      return {
        items: cartItems.map((cartItem: { item_code: string; pricing_override?: { value: number }; qty: number; uom?: string }) => ({
          actual_qty: null,
          allow_negative_stock: false,
          amount: cartItem.pricing_override?.value || 125,
          is_stock_item: cartItem.item_code !== 'DELIVERY',
          item_code: cartItem.item_code,
          item_name: cartItem.item_code === 'DELIVERY' ? 'Delivery charge' : 'Stock item',
          qty: cartItem.qty,
          rate: cartItem.pricing_override?.value || 125,
          uom: cartItem.uom || 'Nos',
        })),
        taxes: [],
        totals: { grand_total: 175, net_total: 175 },
      };
    });
    const hook = await renderHook(() => usePosCart({ customer: { customer: 'CUST-001', customerName: 'Example customer' }, posProfile: 'POS-001' }));

    await act(async () => { await hook.result.current.add(item); });
    await act(async () => { await hook.result.current.applyDeliveryCharge('DELIVERY', 50); });

    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.item.get_item_details', {
      customer: 'CUST-001',
      item_code: 'DELIVERY',
      pos_profile: 'POS-001',
    });
    expect(mockGetVunaMethod).toHaveBeenLastCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.preview_invoice', expect.objectContaining({
      items: '[{"item_code":"ITEM-001","qty":1,"uom":"Nos"},{"item_code":"DELIVERY","pricing_override":{"type":"rate","value":50},"qty":1,"uom":"Nos"}]',
    }));
    expect(hook.result.current.items).toEqual(expect.arrayContaining([expect.objectContaining({ item_code: 'DELIVERY', pricing_override: { type: 'rate', value: 50 }, rate: 50 })]));
  });
});
