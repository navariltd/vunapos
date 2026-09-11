import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosCheckoutPreview, useSubmitPosCheckout } from '@/features/pos/hooks/usePosCheckout';
import { getVunaMethod, postVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const invalidateSession = jest.fn();
const item = { allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 2, rate: 125, uom: 'Nos' };

describe('POS checkout hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession, sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('requests a server preview with only cart data needed for pricing and stock validation', async () => {
    mockGetVunaMethod.mockResolvedValue({ totals: { grand_total: 290, net_total: 250 } });
    const hook = await renderHook(() => usePosCheckoutPreview({ customer: 'CUST-001', items: [item], posProfile: 'POS-001' }));

    await waitFor(() => expect(hook.result.current.data).toEqual({ totals: { grand_total: 290, net_total: 250 } }));
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.preview_invoice', {
      customer: 'CUST-001',
      items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
      pos_profile: 'POS-001',
    }, expect.any(AbortSignal));
  });

  it('re-previews the cart with requested loyalty points so the server validates the redemption', async () => {
    mockGetVunaMethod.mockResolvedValue({ loyalty_amount: 20, loyalty_points: 10, totals: { grand_total: 290, net_total: 250 } });
    const hook = await renderHook(() => usePosCheckoutPreview({ customer: 'CUST-001', items: [item], loyaltyPoints: 10, posProfile: 'POS-001' }));

    await waitFor(() => expect(hook.result.current.data?.loyalty_amount).toBe(20));
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.preview_invoice', {
      customer: 'CUST-001',
      items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
      loyalty_points: 10,
      pos_profile: 'POS-001',
    }, expect.any(AbortSignal));
  });

  it('submits a checkout with serialized cart, payment allocation, and a retry-safe key', async () => {
    mockPostVunaMethod.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0001' });
    const hook = await renderHook(() => useSubmitPosCheckout());
    let result: Awaited<ReturnType<typeof hook.result.current.submit>> | undefined;

    await act(async () => {
      result = await hook.result.current.submit({
        customer: 'CUST-001',
        isCreditSale: false,
        items: [item],
        orderType: 'Invoice',
        payments: [{ amount: 290, mode_of_payment: 'Cash' }],
        posProfile: 'POS-001',
      });
    });

    expect(result).toEqual({ doctype: 'Sales Invoice', name: 'SINV-0001' });
    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_and_submit_invoice', {
      customer: 'CUST-001',
      idempotency_key: expect.stringMatching(/^mobile-checkout-/),
      items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
      payments: '[{"amount":290,"mode_of_payment":"Cash"}]',
      pos_profile: 'POS-001',
    });
  });

  it('sends credit-only fields only when the cashier enables a credit sale', async () => {
    mockPostVunaMethod.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0002' });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: 'CUST-001',
        dueDate: '2026-09-30',
        isCreditSale: true,
        items: [item],
        orderType: 'Invoice',
        payments: [{ amount: 40, mode_of_payment: 'Cash' }],
        posProfile: 'POS-001',
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_and_submit_invoice', expect.objectContaining({
      due_date: '2026-09-30',
      is_credit_sale: true,
    }));
  });

  it('submits only server-validated loyalty points with an Invoice', async () => {
    mockPostVunaMethod.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0004' });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: 'CUST-001',
        isCreditSale: false,
        items: [item],
        loyaltyPoints: 10,
        orderType: 'Invoice',
        payments: [{ amount: 270, mode_of_payment: 'Cash' }],
        posProfile: 'POS-001',
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_and_submit_invoice', expect.objectContaining({ loyalty_points: 10 }));
  });

  it('serializes manual payment transaction references for invoice checkout', async () => {
    mockPostVunaMethod.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0003' });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: 'CUST-001',
        isCreditSale: false,
        items: [item],
        orderType: 'Invoice',
        payments: [{ amount: 290, mode_of_payment: 'Bank transfer', reference_date: '2026-09-08', reference_no: 'RCP-001' }],
        posProfile: 'POS-001',
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_and_submit_invoice', expect.objectContaining({
      payments: '[{"amount":290,"mode_of_payment":"Bank transfer","reference_date":"2026-09-08","reference_no":"RCP-001"}]',
    }));
  });

  it('uses the sales-order endpoint with a delivery date and without invoice-only fields', async () => {
    mockPostVunaMethod.mockResolvedValue({ doctype: 'Sales Order', name: 'SAL-ORD-0001' });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        deliveryDate: '2026-09-30',
        isCreditSale: false,
        items: [item],
        orderType: 'Order',
        payments: [{ amount: 40, mode_of_payment: 'Cash' }],
        posProfile: 'POS-001',
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_and_submit_sales_order', expect.objectContaining({
      delivery_date: '2026-09-30',
      payments: '[{"amount":40,"mode_of_payment":"Cash"}]',
    }));
    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_and_submit_sales_order', expect.not.objectContaining({ due_date: expect.anything(), is_credit_sale: expect.anything() }));
  });
});
