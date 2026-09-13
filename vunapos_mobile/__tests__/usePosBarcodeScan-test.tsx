import { act, cleanup, renderHook } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {
    readonly code: string;

    constructor(message: string, readonly mockCode: string) {
      super(message);
      this.code = mockCode;
    }
  },
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { usePosBarcodeScan } from '@/features/pos/hooks/usePosBarcodeScan';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

const invalidateSession = jest.fn();
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe('usePosBarcodeScan', () => {
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

  it('resolves a scan with the active POS, customer, and price-list context', async () => {
    const item = { actual_qty: 3, item_code: 'ITEM-001', item_name: 'Scanned item', rate: 100 };
    mockGetVunaMethod.mockResolvedValue(item);
    const hook = await renderHook(() => usePosBarcodeScan({ customer: 'CUST-001', posProfile: 'POS-001', priceList: 'Retail' }));

    let result: Awaited<ReturnType<typeof hook.result.current.resolve>> | undefined;
    await act(async () => {
      result = await hook.result.current.resolve(' 0123456789 ');
    });

    expect(result).toEqual({ item, ok: true });
    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.item.resolve_barcode', {
      barcode: '0123456789',
      customer: 'CUST-001',
      pos_profile: 'POS-001',
      price_list: 'Retail',
    });
  });

  it('keeps an unknown barcode in the scanner and returns the server message', async () => {
    mockGetVunaMethod.mockRejectedValue(new Error('No sellable item was found for barcode 123.'));
    const hook = await renderHook(() => usePosBarcodeScan({ posProfile: 'POS-001' }));

    let result: Awaited<ReturnType<typeof hook.result.current.resolve>> | undefined;
    await act(async () => {
      result = await hook.result.current.resolve('123');
    });
    expect(result).toEqual({ message: 'No sellable item was found for barcode 123.', ok: false });
  });

  it('expires the session when resolving a barcode receives an authentication failure', async () => {
    mockGetVunaMethod.mockRejectedValue(new FrappeClientError('Your session has expired.', 'session'));
    const hook = await renderHook(() => usePosBarcodeScan({ posProfile: 'POS-001' }));

    let result: Awaited<ReturnType<typeof hook.result.current.resolve>> | undefined;
    await act(async () => {
      result = await hook.result.current.resolve('123');
    });
    expect(result).toEqual({ message: 'Your session has expired.', ok: false });
    expect(invalidateSession).toHaveBeenCalledTimes(1);
  });
});
