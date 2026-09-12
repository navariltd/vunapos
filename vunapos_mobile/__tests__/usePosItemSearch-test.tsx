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

  it('does not make a catalogue request while network actions are disabled', async () => {
    const hook = await renderHook(() =>
      usePosItemSearch({ enabled: false, loadAll: true, posProfile: 'POS-001', query: 'item' }),
    );

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
  });

  it('retains the last complete catalogue for local offline browsing', async () => {
    const items = [{ actual_qty: 4, item_code: 'CACHE-001', item_name: 'Cached item', rate: 120 }];
    mockGetVunaMethod.mockResolvedValue(items);
    const hook = await renderHook<
      ReturnType<typeof usePosItemSearch>,
      { enabled: boolean }
    >(
      ({ enabled }) =>
        usePosItemSearch({ enabled, loadAll: true, posProfile: 'POS-001', query: '' }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(hook.result.current.cachedItems).toEqual(items));
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(1);

    await hook.rerender({ enabled: false });
    expect(hook.result.current.cachedItems).toEqual(items);
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(1);
  });

  it('loads the catalogue again with an explicitly selected permitted price list', async () => {
    mockGetVunaMethod.mockResolvedValue([{ actual_qty: 4, item_code: 'BAR-001', item_name: 'Wholesale item', rate: 90 }]);
    const hook = await renderHook(() => usePosItemSearch({ customer: 'CUST-001', loadAll: true, posProfile: 'POS-001', priceList: 'Wholesale', query: '' }));

    await waitFor(() => expect(hook.result.current.items[0]?.rate).toBe(90));
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.item.search_items', expect.objectContaining({
      customer: 'CUST-001',
      limit: 0,
      pos_profile: 'POS-001',
      price_list: 'Wholesale',
      query: '',
    }), expect.any(AbortSignal));
  });

  it('uses an unlimited empty-query request when loading the full catalogue', async () => {
    mockGetVunaMethod.mockResolvedValue([]);

    const hook = await renderHook(() =>
      usePosItemSearch({ loadAll: true, posProfile: 'POS-001', query: '' }),
    );

    await waitFor(() => expect(hook.result.current.hasLoaded).toBe(true));
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      'https://vuna.example.com',
      'sid-1',
      'vunapos.api.item.search_items',
      expect.objectContaining({ limit: 0, pos_profile: 'POS-001', query: '' }),
      expect.any(AbortSignal),
    );
  });
});
