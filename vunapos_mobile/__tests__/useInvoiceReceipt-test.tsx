import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-print', () => ({
  printAsync: jest.fn(),
  printToFileAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

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

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useInvoiceReceipt } from '@/features/pos/hooks/useInvoiceReceipt';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockPrintAsync = jest.mocked(Print.printAsync);
const mockPrintToFileAsync = jest.mocked(Print.printToFileAsync);
const mockIsAvailableAsync = jest.mocked(Sharing.isAvailableAsync);
const mockShareAsync = jest.mocked(Sharing.shareAsync);
const invalidateSession = jest.fn();
const request = { invoiceDoctype: 'POS Invoice', invoiceName: 'POS-INV-0001' };

describe('useInvoiceReceipt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      companyUrl: 'https://vuna.example.com',
      invalidateSession,
      sessionId: 'sid-1',
    } as unknown as ReturnType<typeof useAppSession>);
    mockGetVunaMethod.mockResolvedValue({ html: '<html><body>Receipt</body></html>', invoice_doctype: 'POS Invoice', invoice_name: 'POS-INV-0001' });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('requests the server receipt and opens native print preview', async () => {
    const hook = await renderHook(() => useInvoiceReceipt());

    await act(async () => {
      await hook.result.current.printReceipt(request);
    });

    expect(mockGetVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.print.render_invoice', {
      invoice_doctype: 'POS Invoice',
      invoice_name: 'POS-INV-0001',
    });
    expect(mockPrintAsync).toHaveBeenCalledWith({ html: '<html><body>Receipt</body></html>' });
    expect(hook.result.current).toMatchObject({ error: null, isWorking: false });
  });

  it('creates a PDF and opens the native share sheet', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockPrintToFileAsync.mockResolvedValue({ numberOfPages: 1, uri: 'file:///cache/receipt.pdf' });
    const hook = await renderHook(() => useInvoiceReceipt());

    await act(async () => {
      await hook.result.current.shareReceipt(request);
    });

    expect(mockPrintToFileAsync).toHaveBeenCalledWith({ html: '<html><body>Receipt</body></html>' });
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/receipt.pdf', { UTI: 'com.adobe.pdf', mimeType: 'application/pdf' });
  });

  it('reports an unavailable share sheet without creating a PDF', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);
    const hook = await renderHook(() => useInvoiceReceipt());

    await act(async () => {
      await hook.result.current.shareReceipt(request);
    });

    await waitFor(() => expect(hook.result.current.error).toBe('Sharing is not available on this device.'));
    expect(mockPrintToFileAsync).not.toHaveBeenCalled();
  });

  it('invalidates the session when receipt rendering is rejected by Frappe', async () => {
    mockGetVunaMethod.mockRejectedValue(new FrappeClientError('Your session has expired. Sign in again to continue.', 'session'));
    const hook = await renderHook(() => useInvoiceReceipt());

    await act(async () => {
      await hook.result.current.printReceipt(request);
    });

    expect(invalidateSession).toHaveBeenCalledTimes(1);
    expect(mockPrintAsync).not.toHaveBeenCalled();
  });
});
