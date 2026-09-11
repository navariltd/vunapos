import { act, cleanup, renderHook } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useGatewayPayment } from '@/features/pos/hooks/useGatewayPayment';
import { getVunaMethod, postVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockPostVunaMethod = jest.mocked(postVunaMethod);

describe('gateway payment hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession: jest.fn(), sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('starts an STK request, finds C2B payments, and attaches only through server-owned endpoints', async () => {
    mockPostVunaMethod.mockResolvedValue({ amount: 116, mode_of_payment: 'M-Pesa', name: 'GPL-001', status: 'Pending' });
    mockGetVunaMethod.mockResolvedValue({ amount: 116, mode_of_payment: 'M-Pesa', name: 'GPL-001', status: 'Paid' });
    const hook = await renderHook(() => useGatewayPayment());

    await act(async () => {
      await hook.result.current.initiate({
        amount: 116,
        currency: 'KES',
        customer: 'CUST-001',
        idempotencyKey: 'gateway-key',
        modeOfPayment: 'M-Pesa',
        phoneNumber: '0712345678',
        posProfile: 'POS-001',
      });
      await hook.result.current.getStatus('GPL-001');
      await hook.result.current.searchC2B({
        currency: 'KES',
        customer: 'CUST-001',
        modeOfPayment: 'M-Pesa',
        posProfile: 'POS-001',
        query: 'TXN-001',
      });
      await hook.result.current.attachC2B({
        amount: 116,
        currency: 'KES',
        customer: 'CUST-001',
        idempotencyKey: 'c2b-key',
        modeOfPayment: 'M-Pesa',
        posProfile: 'POS-001',
        transactionReference: 'TXN-001',
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.gateway.initiate_stk_gateway_payment', {
      amount: 116,
      currency: 'KES',
      customer: 'CUST-001',
      idempotency_key: 'gateway-key',
      mode_of_payment: 'M-Pesa',
      phone_number: '0712345678',
      pos_profile: 'POS-001',
    });
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.gateway.get_gateway_payment_status', { gateway_payment_link: 'GPL-001' });
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.gateway.search_c2b_gateway_payments', {
      currency: 'KES',
      customer: 'CUST-001',
      mode_of_payment: 'M-Pesa',
      pos_profile: 'POS-001',
      query: 'TXN-001',
    });
    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.gateway.attach_c2b_gateway_payment', {
      amount: 116,
      currency: 'KES',
      customer: 'CUST-001',
      idempotency_key: 'c2b-key',
      mode_of_payment: 'M-Pesa',
      pos_profile: 'POS-001',
      transaction_reference: 'TXN-001',
    });
  });
});
