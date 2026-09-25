import { cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));
const mockUseNetworkStatus = jest.fn();
jest.mock('@/services/NetworkStatusProvider', () => ({ useNetworkStatus: () => mockUseNetworkStatus() }));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosCustomerShippingAddresses } from '@/features/pos/hooks/usePosCustomerShippingAddresses';
import { getVunaMethod } from '@/services/frappeClient';

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe('POS customer shipping-address hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: 'online' });
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession: jest.fn(), sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('loads the customer-linked, profile-permitted addresses for checkout', async () => {
    mockGetVunaMethod.mockResolvedValue([{ address_title: 'Main branch', name: 'ADDR-001' }]);
    const hook = await renderHook(() => usePosCustomerShippingAddresses('CUST-001', 'POS-001'));

    await waitFor(() => expect(hook.result.current.data).toEqual([{ address_title: 'Main branch', name: 'ADDR-001' }]));
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.customer.get_customer_addresses', {
      customer: 'CUST-001',
      limit: 100,
      pos_profile: 'POS-001',
    }, expect.any(AbortSignal));
  });

  it('does not request customer addresses while offline', async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: 'offline' });
    const hook = await renderHook(() => usePosCustomerShippingAddresses('CUST-001', 'POS-001'));

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.isLoading).toBe(false);
  });
});
