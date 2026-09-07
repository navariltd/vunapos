import { cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({ useAppSession: jest.fn() }));
jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosCustomerSearch } from '@/features/pos/hooks/usePosCustomerSearch';
import { getVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const invalidateSession = jest.fn();

describe('usePosCustomerSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession, sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => cleanup());

  it('searches permitted Frappe customers and maps them for a POS sale', async () => {
    mockGetVunaMethod.mockResolvedValue([{ customer: 'CUST-001', customer_name: 'Acme Stores', mobile_no: '+254700000000' }]);
    const hook = await renderHook(() => usePosCustomerSearch('acme', true));

    await waitFor(() => expect(hook.result.current.rows).toEqual([{ customer: 'CUST-001', customerName: 'Acme Stores', email: undefined, mobile: '+254700000000' }]));
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.customer.search_customers', { limit: 20, query: 'acme' }, expect.any(AbortSignal));
  });
});
