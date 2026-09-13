import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({ useAppSession: jest.fn() }));
const mockUseNetworkStatus = jest.fn();
jest.mock('@/services/NetworkStatusProvider', () => ({ useNetworkStatus: () => mockUseNetworkStatus() }));
jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useCreatePosCustomer } from '@/features/pos/hooks/useCreatePosCustomer';
import { postVunaMethod } from '@/services/frappeClient';

const mockPostVunaMethod = jest.mocked(postVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe('useCreatePosCustomer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: 'unknown' });
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession: jest.fn(), sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => cleanup());

  it('creates a customer through the profile-scoped Frappe endpoint and maps it for cart selection', async () => {
    mockPostVunaMethod.mockResolvedValue({ customer: 'CUST-001', customer_name: 'Acme Stores', email_id: null, is_walkin: false, mobile_no: null });
    const hook = await renderHook(() => useCreatePosCustomer());

    let customer;
    await act(async () => { customer = await hook.result.current.create('  Acme Stores  ', 'POS-001'); });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.customer.create_customer', {
      customer_name: 'Acme Stores',
      pos_profile: 'POS-001',
    });
    expect(customer).toEqual({ customer: 'CUST-001', customerName: 'Acme Stores', email: null, mobile: null, taxId: undefined });
  });

  it('does not call the server for a blank name', async () => {
    const hook = await renderHook(() => useCreatePosCustomer());

    await act(async () => { await hook.result.current.create('   ', 'POS-001'); });

    expect(mockPostVunaMethod).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.error).toBe('Enter a customer name.'));
  });

  it('does not create a customer while offline', async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: 'offline' });
    const hook = await renderHook(() => useCreatePosCustomer());

    await act(async () => { await hook.result.current.create('Acme Stores', 'POS-001'); });

    expect(mockPostVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('Connection unavailable. Reconnect before creating a customer.');
  });
});
