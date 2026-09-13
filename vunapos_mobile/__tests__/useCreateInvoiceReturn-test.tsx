import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useCreateInvoiceReturn } from '@/features/pos/hooks/useCreateInvoiceReturn';
import { postVunaMethod } from '@/services/frappeClient';

const mockUseAppSession = jest.mocked(useAppSession);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const invalidateSession = jest.fn();

describe('useCreateInvoiceReturn', () => {
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

  it('creates a credit note with selected rows and a retry-safe idempotency key', async () => {
    const response = { duplicate: false, invoice: { name: 'POS-INV-RETURN-0001' } };
    mockPostVunaMethod.mockResolvedValue(response);
    const hook = await renderHook(() => useCreateInvoiceReturn());
    let result: Awaited<ReturnType<typeof hook.result.current.create>> | undefined;

    await act(async () => {
      result = await hook.result.current.create({
        invoiceName: 'POS-INV-0001',
        items: [{ qty: 1.5, row_name: 'row-1' }],
        posProfile: 'POS-001',
        reason: 'Damaged in transit',
      });
    });

    expect(result).toEqual(response);
    expect(mockPostVunaMethod).toHaveBeenCalledWith('https://vuna.example.com', 'sid-1', 'vunapos.api.sales.create_invoice_return', {
      idempotency_key: expect.stringMatching(/^mobile-return-/),
      invoice_name: 'POS-INV-0001',
      items: '[{"qty":1.5,"row_name":"row-1"}]',
      pos_profile: 'POS-001',
      reason: 'Damaged in transit',
    });
  });

  it('keeps the user in the sheet and shows the request error when submission fails', async () => {
    mockPostVunaMethod.mockRejectedValue(new Error('No active POS shift.'));
    const hook = await renderHook(() => useCreateInvoiceReturn());

    await act(async () => {
      await hook.result.current.create({ invoiceName: 'POS-INV-0001', items: [{ qty: 1, row_name: 'row-1' }], posProfile: 'POS-001', reason: 'Damaged' });
    });

    await waitFor(() => expect(hook.result.current.error).toBe('No active POS shift.'));
  });
});
