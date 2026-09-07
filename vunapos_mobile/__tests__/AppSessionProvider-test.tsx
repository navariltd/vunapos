import { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/services/sessionStore', () => ({
  clearStoredCompanyUrl: jest.fn(),
  clearStoredSession: jest.fn(),
  loadStoredCompanyUrl: jest.fn(),
  loadStoredSessionId: jest.fn(),
  persistCompanyUrl: jest.fn(),
  persistSessionId: jest.fn(),
}));

jest.mock('@/services/frappeClient', () => {
  const actual = jest.requireActual('@/services/frappeClient');
  return {
    ...actual,
    signInToFrappe: jest.fn(),
    validateFrappeSession: jest.fn(),
    verifyVunaPosSite: jest.fn(),
  };
});

import { AppSessionProvider, useAppSession } from '@/features/auth/AppSessionProvider';
import { FrappeClientError, signInToFrappe, validateFrappeSession, verifyVunaPosSite } from '@/services/frappeClient';
import {
  clearStoredCompanyUrl,
  clearStoredSession,
  loadStoredCompanyUrl,
  loadStoredSessionId,
  persistCompanyUrl,
  persistSessionId,
} from '@/services/sessionStore';

const sessionStore = {
  clearStoredCompanyUrl: jest.mocked(clearStoredCompanyUrl),
  clearStoredSession: jest.mocked(clearStoredSession),
  loadStoredCompanyUrl: jest.mocked(loadStoredCompanyUrl),
  loadStoredSessionId: jest.mocked(loadStoredSessionId),
  persistCompanyUrl: jest.mocked(persistCompanyUrl),
  persistSessionId: jest.mocked(persistSessionId),
};
const frappeClient = {
  signInToFrappe: jest.mocked(signInToFrappe),
  validateFrappeSession: jest.mocked(validateFrappeSession),
  verifyVunaPosSite: jest.mocked(verifyVunaPosSite),
};

function wrapper({ children }: PropsWithChildren) {
  return <AppSessionProvider>{children}</AppSessionProvider>;
}

async function renderSession() {
  const session = await renderHook(() => useAppSession(), { wrapper });
  await waitFor(() => expect(session.result.current.isBootstrapping).toBe(false));
  return session;
}

describe('AppSessionProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(null);
    sessionStore.loadStoredSessionId.mockResolvedValue(null);
    frappeClient.validateFrappeSession.mockResolvedValue('valid');
  });

  it('starts at company setup when this device has no saved company URL', async () => {
    const session = await renderSession();

    expect(session.result.current.authState).toBe('needsCompanyUrl');
    expect(session.result.current.companyUrl).toBeNull();
    expect(session.result.current.sessionId).toBeNull();
  });

  it('fails safely to company setup when stored authentication data cannot be read', async () => {
    sessionStore.loadStoredCompanyUrl.mockRejectedValue(new Error('storage unavailable'));

    const session = await renderSession();

    expect(session.result.current.authState).toBe('needsCompanyUrl');
    expect(session.result.current.isBootstrapping).toBe(false);
  });

  it('shows sign-in when a company URL exists without a saved session', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');

    const session = await renderSession();

    expect(session.result.current).toMatchObject({
      authState: 'signedOut',
      companyUrl: 'https://vuna.example.com',
      sessionId: null,
    });
    expect(frappeClient.validateFrappeSession).not.toHaveBeenCalled();
  });

  it('restores a valid saved session and retains it when the server is temporarily unavailable', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');
    sessionStore.loadStoredSessionId.mockResolvedValue('sid-1');
    frappeClient.validateFrappeSession.mockResolvedValue('unavailable');

    const session = await renderSession();

    expect(session.result.current.authState).toBe('signedIn');
    expect(session.result.current.companyUrl).toBe('https://vuna.example.com');
    expect(session.result.current.sessionId).toBe('sid-1');
    expect(sessionStore.clearStoredSession).not.toHaveBeenCalled();
  });

  it('clears an expired saved session and requires sign-in again', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');
    sessionStore.loadStoredSessionId.mockResolvedValue('sid-1');
    frappeClient.validateFrappeSession.mockResolvedValue('expired');

    const session = await renderSession();

    expect(session.result.current.authState).toBe('sessionExpired');
    expect(session.result.current.sessionId).toBeNull();
    expect(sessionStore.clearStoredSession).toHaveBeenCalledTimes(1);
  });

  it('saves a verified company URL and clears a previous company session', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://old.example.com');
    sessionStore.loadStoredSessionId.mockResolvedValue('old-sid');

    const session = await renderSession();
    let result: Awaited<ReturnType<typeof session.result.current.saveCompanyUrl>> | undefined;
    await act(async () => {
      result = await session.result.current.saveCompanyUrl('vuna.example.com');
    });

    expect(result).toEqual({ ok: true });
    expect(frappeClient.verifyVunaPosSite).toHaveBeenCalledWith('https://vuna.example.com');
    expect(sessionStore.clearStoredSession).toHaveBeenCalledTimes(1);
    expect(sessionStore.persistCompanyUrl).toHaveBeenCalledWith('https://vuna.example.com');
    expect(session.result.current).toMatchObject({
      authState: 'signedOut',
      companyUrl: 'https://vuna.example.com',
      sessionId: null,
    });
  });

  it('does not save an unverified company URL', async () => {
    frappeClient.verifyVunaPosSite.mockRejectedValue(new FrappeClientError('That address did not respond as a VunaPOS site.', 'connection'));

    const session = await renderSession();
    let result: Awaited<ReturnType<typeof session.result.current.saveCompanyUrl>> | undefined;
    await act(async () => {
      result = await session.result.current.saveCompanyUrl('vuna.example.com');
    });

    expect(result).toEqual({ ok: false, message: 'That address did not respond as a VunaPOS site.' });
    expect(sessionStore.persistCompanyUrl).not.toHaveBeenCalled();
    expect(session.result.current.authState).toBe('needsCompanyUrl');
  });

  it('keeps an existing session when the verified company URL is unchanged', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');
    sessionStore.loadStoredSessionId.mockResolvedValue('sid-1');

    const session = await renderSession();
    await act(async () => {
      await session.result.current.saveCompanyUrl('vuna.example.com');
    });

    expect(sessionStore.clearStoredSession).not.toHaveBeenCalled();
    expect(session.result.current.sessionId).toBe('sid-1');
  });

  it('persists a successful sign-in and supports sign-out and explicit session invalidation', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');
    frappeClient.signInToFrappe.mockResolvedValue('new-sid');

    const session = await renderSession();
    let signInResult: Awaited<ReturnType<typeof session.result.current.signIn>> | undefined;
    await act(async () => {
      signInResult = await session.result.current.signIn('cashier', 'secret');
    });

    expect(signInResult).toEqual({ ok: true });
    expect(frappeClient.signInToFrappe).toHaveBeenCalledWith('https://vuna.example.com', 'cashier', 'secret');
    expect(sessionStore.persistSessionId).toHaveBeenCalledWith('new-sid');
    expect(session.result.current.authState).toBe('signedIn');

    await act(async () => {
      await session.result.current.signOut();
    });
    expect(session.result.current.authState).toBe('signedOut');

    await act(async () => {
      await session.result.current.invalidateSession();
    });
    expect(session.result.current.authState).toBe('sessionExpired');
    expect(sessionStore.clearStoredSession).toHaveBeenCalledTimes(2);
  });

  it('keeps the user signed out when Frappe rejects their sign-in', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');
    frappeClient.signInToFrappe.mockRejectedValue(new FrappeClientError('Sign-in failed. Check your details and try again.', 'login'));

    const session = await renderSession();
    let signInResult: Awaited<ReturnType<typeof session.result.current.signIn>> | undefined;
    await act(async () => {
      signInResult = await session.result.current.signIn('cashier', 'wrong-password');
    });

    expect(signInResult).toEqual({ ok: false, message: 'Sign-in failed. Check your details and try again.' });
    expect(sessionStore.persistSessionId).not.toHaveBeenCalled();
    expect(session.result.current.authState).toBe('signedOut');
  });

  it('clears all local authentication data when the company URL is removed', async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue('https://vuna.example.com');
    const session = await renderSession();

    await act(async () => {
      await session.result.current.clearCompanyUrl();
    });

    expect(sessionStore.clearStoredCompanyUrl).toHaveBeenCalledTimes(1);
    expect(session.result.current).toMatchObject({
      authState: 'needsCompanyUrl',
      companyUrl: null,
      sessionId: null,
    });
  });
});
