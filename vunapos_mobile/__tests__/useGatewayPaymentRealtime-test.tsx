import { cleanup, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { GATEWAY_PAYMENT_EVENT, getGatewayRealtimeConnection, useGatewayPaymentRealtime } from '@/features/pos/hooks/useGatewayPaymentRealtime';
import { io } from 'socket.io-client';

const mockIo = jest.mocked(io);
const mockUseAppSession = jest.mocked(useAppSession);

describe('gateway payment realtime hook', () => {
  const disconnect = jest.fn();
  const off = jest.fn();
  const on = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({ companyUrl: 'https://vuna.example.com', sessionId: 'sid-1' } as ReturnType<typeof useAppSession>);
    mockIo.mockReturnValue({ disconnect, off, on } as never);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('connects to Frappe using the saved session and unsubscribes on cleanup', async () => {
    const onChange = jest.fn();
    renderHook(() => useGatewayPaymentRealtime(onChange));

    await waitFor(() => expect(mockIo).toHaveBeenCalledWith('https://vuna.example.com/vuna.example.com', expect.objectContaining({
      extraHeaders: {
        Cookie: 'sid=sid-1',
        Origin: 'https://vuna.example.com',
        'X-Frappe-Site-Name': 'vuna.example.com',
      },
      transports: ['websocket'],
    })));
    expect(on).toHaveBeenCalledWith(GATEWAY_PAYMENT_EVENT, onChange);

    await cleanup();
    expect(off).toHaveBeenCalledWith(GATEWAY_PAYMENT_EVENT, onChange);
    expect(disconnect).toHaveBeenCalled();
  });

  it('uses the Bench Socket.IO port and an optional site-name override for local development', () => {
    const originalSiteName = process.env.EXPO_PUBLIC_FRAPPE_SITE_NAME;
    process.env.EXPO_PUBLIC_FRAPPE_SITE_NAME = 'meru.localhost';

    expect(getGatewayRealtimeConnection('http://10.0.2.2:8000')).toEqual({
      siteName: 'meru.localhost',
      url: 'http://10.0.2.2:9000/meru.localhost',
    });

    process.env.EXPO_PUBLIC_FRAPPE_SITE_NAME = originalSiteName;
  });
});
