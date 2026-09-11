import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { getVunaMethod } from '@/services/frappeClient';

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();

describe('usePosBootstrap', () => {
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

  it('loads the authenticated POS profile and initial catalogue, and supports a manual retry', async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [{ actual_qty: 3, item_code: 'LIVE-001', item_name: 'Live catalogue item', rate: 150 }],
      payment_modes: [],
      pos_profile: { currency: 'KES', name: 'POS-001' },
    });
    const hook = await renderHook(() => usePosBootstrap());

    await waitFor(() => expect(hook.result.current.data?.pos_profile.name).toBe('POS-001'));
    expect(hook.result.current.data?.items).toHaveLength(1);
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.pos.get_pos_bootstrap', {}, expect.any(AbortSignal));

    await act(async () => hook.result.current.reload());
    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(2));
  });
});
