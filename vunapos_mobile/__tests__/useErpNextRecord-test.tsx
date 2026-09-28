import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}));

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

import * as WebBrowser from 'expo-web-browser';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { erpNextRecordUrl, useErpNextRecord } from '@/features/pos/hooks/useErpNextRecord';

const mockUseAppSession = jest.mocked(useAppSession);
const mockOpenBrowserAsync = jest.mocked(WebBrowser.openBrowserAsync);

describe('useErpNextRecord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com' } as ReturnType<typeof useAppSession>);
    mockOpenBrowserAsync.mockResolvedValue({} as Awaited<ReturnType<typeof WebBrowser.openBrowserAsync>>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('builds a Desk URL with normalized doctype and encoded record name', () => {
    expect(erpNextRecordUrl('https://vuna.example.com', { doctype: 'Payment Entry', name: 'ACC PAY/0001' })).toBe('https://vuna.example.com/app/payment-entry/ACC%20PAY%2F0001');
  });

  it('opens the related record in the device browser', async () => {
    const hook = await renderHook(() => useErpNextRecord());

    await act(async () => {
      await hook.result.current.openRecord({ doctype: 'POS Invoice', name: 'POS-INV-0001' });
    });

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://vuna.example.com/app/pos-invoice/POS-INV-0001');
    expect(hook.result.current).toMatchObject({ error: null, isOpening: false });
  });

  it('shows a clear error when no company URL is available', async () => {
    mockUseAppSession.mockReturnValue({ companyUrl: null } as ReturnType<typeof useAppSession>);
    const hook = await renderHook(() => useErpNextRecord());

    await act(async () => {
      await hook.result.current.openRecord({ doctype: 'POS Invoice', name: 'POS-INV-0001' });
    });

    await waitFor(() => expect(hook.result.current.error).toBe('Set a company URL before opening ERPNext.'));
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('reports device-browser failures', async () => {
    mockOpenBrowserAsync.mockRejectedValue(new Error('No browser is installed.'));
    const hook = await renderHook(() => useErpNextRecord());

    await act(async () => {
      await hook.result.current.openRecord({ doctype: 'POS Invoice', name: 'POS-INV-0001' });
    });

    await waitFor(() => expect(hook.result.current.error).toBe('No browser is installed.'));
  });
});
