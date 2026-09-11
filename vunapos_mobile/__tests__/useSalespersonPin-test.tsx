import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useSalespersonPin } from '@/features/pos/hooks/useSalespersonPin';
import { postVunaMethod } from '@/services/frappeClient';

const mockPostVunaMethod = jest.mocked(postVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe('salesperson PIN session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession: jest.fn(), sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('verifies a salesperson PIN and retains only the short-lived server-issued token', async () => {
    mockPostVunaMethod.mockResolvedValue({ display_name: 'Alex Cashier', expires_in: 900, salesperson: 'SP-001', token: 'server-issued-token' });
    const hook = await renderHook(() => useSalespersonPin());

    await act(async () => {
      await hook.result.current.verify('POS-001', 'SP-001', '1234');
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.pin.verify_salesperson', {
      pin: '1234',
      pos_profile: 'POS-001',
      salesperson: 'SP-001',
    });
    await waitFor(() => expect(hook.result.current.session).toEqual(expect.objectContaining({
      displayName: 'Alex Cashier',
      name: 'SP-001',
      token: 'server-issued-token',
    })));

    await act(async () => { hook.result.current.lock(); });
    expect(hook.result.current.session).toBeNull();
  });
});
