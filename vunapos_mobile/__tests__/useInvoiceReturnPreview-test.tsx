import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {
    code: string;

    constructor(message: string, errorCode: string) {
      super(message);
      this.code = errorCode;
    }
  },
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useInvoiceReturnPreview } from '@/features/pos/hooks/useInvoiceReturnPreview';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const invalidateSession = jest.fn();

describe('useInvoiceReturnPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', invalidateSession, sessionId: 'sid-1' } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('does not request a return preview while the sheet is closed', async () => {
    await renderHook(() => useInvoiceReturnPreview({ enabled: false, invoiceName: 'POS-INV-0001', posProfile: 'POS-001' }));

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
  });

  it('requests server-authoritative return quantities when the sheet opens', async () => {
    mockGetVunaMethod.mockResolvedValue({ currency: 'KES', invoice: 'POS-INV-0001', items: [] });
    const hook = await renderHook(() => useInvoiceReturnPreview({ enabled: true, invoiceName: 'POS-INV-0001', posProfile: 'POS-001' }));

    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.get_return_preview', {
      invoice_name: 'POS-INV-0001',
      pos_profile: 'POS-001',
    }, expect.any(AbortSignal)));
    expect(hook.result.current.data).toEqual({ currency: 'KES', invoice: 'POS-INV-0001', items: [] });
  });

  it('reports preview errors without retaining stale return data', async () => {
    mockGetVunaMethod.mockRejectedValue(new Error('No active POS shift.'));
    const hook = await renderHook(() => useInvoiceReturnPreview({ enabled: true, invoiceName: 'POS-INV-0001', posProfile: 'POS-001' }));

    await waitFor(() => expect(hook.result.current).toMatchObject({ data: null, error: 'No active POS shift.', isLoading: false }));
  });

  it('invalidates an expired Frappe session', async () => {
    mockGetVunaMethod.mockRejectedValue(new FrappeClientError('Your session has expired. Sign in again to continue.', 'session'));
    const hook = await renderHook(() => useInvoiceReturnPreview({ enabled: true, invoiceName: 'POS-INV-0001', posProfile: 'POS-001' }));

    await act(async () => {});
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledTimes(1));
    expect(hook.result.current.error).toBeNull();
  });
});
