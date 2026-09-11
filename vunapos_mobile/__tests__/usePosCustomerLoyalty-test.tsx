import { cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosCustomerLoyalty } from '@/features/pos/hooks/usePosCustomerLoyalty';
import { getVunaMethod } from '@/services/frappeClient';

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe('POS customer loyalty hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession: jest.fn(), sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('loads the live, profile-scoped loyalty balance required for redemption', async () => {
    mockGetVunaMethod.mockResolvedValue({ conversion_factor: 2, enrolled: true, points: 60, redemption_value: 120 });
    const hook = await renderHook(() => usePosCustomerLoyalty('CUST-001', 'POS-001'));

    await waitFor(() => expect(hook.result.current.data).toEqual({ conversion_factor: 2, enrolled: true, points: 60, redemption_value: 120 }));
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.customer.get_customer_loyalty', {
      customer: 'CUST-001',
      pos_profile: 'POS-001',
    }, expect.any(AbortSignal));
  });
});
