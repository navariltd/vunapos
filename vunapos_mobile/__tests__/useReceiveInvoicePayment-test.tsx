import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useReceiveInvoicePayment } from '@/features/pos/hooks/useReceiveInvoicePayment';
import { postVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const invalidateSession = jest.fn();

describe('useReceiveInvoicePayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      companyUrl: 'https://vuna.example.com',
      invalidateSession,
      sessionId: 'sid-1',
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('submits one invoice allocation with a retry-safe idempotency key', async () => {
    mockPostVunaMethod.mockResolvedValue({ name: 'ACC-PAY-0001' });
    const hook = await renderHook(() => useReceiveInvoicePayment());
    let result: Awaited<ReturnType<typeof hook.result.current.receive>> | undefined;

    await act(async () => {
      result = await hook.result.current.receive({
        amount: 150,
        customer: 'CUST-001',
        invoice: 'SINV-0001',
        modeOfPayment: 'Cash',
        posProfile: 'POS-001',
      });
    });

    expect(result).toEqual({ name: 'ACC-PAY-0001' });
    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.payment.receive_customer_payment', {
      allocated_amount: 150,
      amount: 150,
      customer: 'CUST-001',
      idempotency_key: expect.stringMatching(/^mobile-payment-/),
      mode_of_payment: 'Cash',
      pos_profile: 'POS-001',
      reference_date: undefined,
      reference_no: undefined,
      sales_invoice: 'SINV-0001',
    });
    expect(hook.result.current).toMatchObject({ error: null, isSubmitting: false });
  });

  it('shows request errors instead of claiming a payment was received', async () => {
    mockPostVunaMethod.mockRejectedValue(new Error('No active POS shift.'));
    const hook = await renderHook(() => useReceiveInvoicePayment());

    await act(async () => {
      await hook.result.current.receive({ amount: 150, customer: 'CUST-001', invoice: 'SINV-0001', modeOfPayment: 'Cash', posProfile: 'POS-001' });
    });

    await waitFor(() => expect(hook.result.current.error).toBe('No active POS shift.'));
  });
});
