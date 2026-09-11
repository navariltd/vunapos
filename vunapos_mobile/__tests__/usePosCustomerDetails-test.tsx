import { cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosCustomerDetails } from '@/features/pos/hooks/usePosCustomerDetails';
import { getVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const invalidateSession = jest.fn();

describe('usePosCustomerDetails', () => {
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

  it('loads the permission-filtered customer details for the active POS profile', async () => {
    mockGetVunaMethod.mockResolvedValue({
      as_of: '2026-09-07 10:00:00',
      balance: 0,
      customer: { customer: 'CUST-001', customer_name: 'Example customer' },
      loyalty: null,
    });

    const hook = await renderHook(() => usePosCustomerDetails({ customer: 'CUST-001', posProfile: 'POS-001' }));

    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledWith(
      'https://vuna.example.com',
      'sid-1',
      'vunapos.api.customer.get_customer_details',
      { customer: 'CUST-001', pos_profile: 'POS-001' },
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(hook.result.current).toMatchObject({
      data: expect.objectContaining({ balance: 0 }),
      error: null,
      isLoading: false,
    }));
  });

  it('does not request customer data before the customer and POS profile are available', async () => {
    const hook = await renderHook(() => usePosCustomerDetails({ customer: '', posProfile: undefined }));

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current).toEqual({ data: null, error: null, isLoading: false });
  });
});
