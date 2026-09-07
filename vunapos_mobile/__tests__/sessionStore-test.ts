jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

import {
  clearStoredCompanyUrl,
  clearStoredSession,
  loadStoredCompanyUrl,
  loadStoredSessionId,
  persistCompanyUrl,
  persistSessionId,
} from '@/services/sessionStore';

const secureStore = jest.mocked(SecureStore);

describe('sessionStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores and retrieves the company URL with its dedicated key', async () => {
    secureStore.getItemAsync.mockResolvedValue('https://vuna.example.com');

    await persistCompanyUrl('https://vuna.example.com');
    await expect(loadStoredCompanyUrl()).resolves.toBe('https://vuna.example.com');

    expect(secureStore.setItemAsync).toHaveBeenCalledWith('vunapos_company_url', 'https://vuna.example.com');
    expect(secureStore.getItemAsync).toHaveBeenCalledWith('vunapos_company_url');
  });

  it('stores and retrieves the Frappe session ID with its dedicated key', async () => {
    secureStore.getItemAsync.mockResolvedValue('session-id');

    await persistSessionId('session-id');
    await expect(loadStoredSessionId()).resolves.toBe('session-id');

    expect(secureStore.setItemAsync).toHaveBeenCalledWith('vunapos_session_id', 'session-id');
    expect(secureStore.getItemAsync).toHaveBeenCalledWith('vunapos_session_id');
  });

  it('clears only the session when signing out', async () => {
    await clearStoredSession();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('vunapos_session_id');
  });

  it('clears both company configuration and session when changing company', async () => {
    await clearStoredCompanyUrl();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(secureStore.deleteItemAsync).toHaveBeenNthCalledWith(1, 'vunapos_company_url');
    expect(secureStore.deleteItemAsync).toHaveBeenNthCalledWith(2, 'vunapos_session_id');
  });

  it('does not hide SecureStore write failures', async () => {
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(persistCompanyUrl('https://vuna.example.com')).rejects.toThrow('storage unavailable');
  });

  it('does not hide SecureStore clear failures', async () => {
    secureStore.deleteItemAsync.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(clearStoredSession()).rejects.toThrow('storage unavailable');
  });
});
