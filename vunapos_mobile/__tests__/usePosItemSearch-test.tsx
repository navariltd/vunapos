import { cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosItemSearch } from '@/features/pos/hooks/usePosItemSearch';
import { getVunaMethod } from '@/services/frappeClient';

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();

describe('usePosItemSearch', () => {
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

  it('searches the authenticated catalogue with the active POS profile', async () => {
    mockGetVunaMethod.mockResolvedValue([{ actual_qty: 4, item_code: 'BAR-001', item_name: 'Barcode item', rate: 120 }]);
    const hook = await renderHook(() => usePosItemSearch({ posProfile: 'POS-001', query: '012345' }));

    await waitFor(() => expect(hook.result.current.items).toEqual([{ actual_qty: 4, item_code: 'BAR-001', item_name: 'Barcode item', rate: 120 }]));

    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.item.search_items', {
      limit: 60,
      pos_profile: 'POS-001',
      query: '012345',
    }, expect.any(AbortSignal));
  });

  it('does not search until the cashier enters a query', async () => {
    const hook = await renderHook(() => usePosItemSearch({ posProfile: 'POS-001', query: '   ' }));

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
  });
});
