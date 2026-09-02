import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { normalizeCompanyUrl } from '@/config/companyUrl';
import { FrappeClientError, signInToFrappe, validateFrappeSession, verifyVunaPosSite } from '@/services/frappeClient';
import {
  clearStoredCompanyUrl,
  clearStoredSession,
  loadStoredCompanyUrl,
  loadStoredSessionId,
  persistCompanyUrl,
  persistSessionId,
} from '@/services/sessionStore';

export type AuthState = 'needsCompanyUrl' | 'signedIn' | 'signedOut' | 'sessionExpired';
type SaveCompanyUrlResult = { ok: true } | { ok: false; message: string };
type SignInResult = { ok: true } | { ok: false; message: string };

type AppSessionContextValue = {
  authState: AuthState;
  companyUrl: string | null;
  invalidateSession: () => Promise<void>;
  isBootstrapping: boolean;
  clearCompanyUrl: () => Promise<void>;
  saveCompanyUrl: (rawUrl: string) => Promise<SaveCompanyUrlResult>;
  sessionId: string | null;
  signIn: (identifier: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: PropsWithChildren) {
  const [companyUrl, setCompanyUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>('needsCompanyUrl');
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const [storedCompanyUrl, storedSessionId] = await Promise.all([loadStoredCompanyUrl(), loadStoredSessionId()]);
        if (!isMounted) return;

        if (!storedCompanyUrl) {
          setAuthState('needsCompanyUrl');
          return;
        }

        setCompanyUrl(storedCompanyUrl);
        if (!storedSessionId) {
          setAuthState('signedOut');
          return;
        }

        const sessionStatus = await validateFrappeSession(storedCompanyUrl, storedSessionId);
        if (!isMounted) return;

        if (sessionStatus === 'expired') {
          await clearStoredSession();
          setSessionId(null);
          setAuthState('sessionExpired');
          return;
        }

        // Do not treat a temporary offline failure as an expired session. Future feature
        // requests will redirect through invalidateSession when the server rejects the SID.
        setSessionId(storedSessionId);
        setAuthState('signedIn');
      } catch {
        if (isMounted) {
          setAuthState('needsCompanyUrl');
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const clearCompanyUrl = useCallback(async () => {
    await clearStoredCompanyUrl();
    setSessionId(null);
    setCompanyUrl(null);
    setAuthState('needsCompanyUrl');
  }, []);

  const saveCompanyUrl = useCallback(async (rawUrl: string): Promise<SaveCompanyUrlResult> => {
    const normalized = normalizeCompanyUrl(rawUrl);
    if (!normalized.ok) {
      return normalized;
    }

    try {
      await verifyVunaPosSite(normalized.url);
      const isDifferentCompany = companyUrl !== normalized.url;
      if (isDifferentCompany) {
        await clearStoredSession();
        setSessionId(null);
      }
      await persistCompanyUrl(normalized.url);
      setCompanyUrl(normalized.url);
      setAuthState('signedOut');
      return { ok: true };
    } catch (error) {
      const message = error instanceof FrappeClientError
        ? error.message
        : 'Could not save that company URL.';
      return { ok: false, message };
    }
  }, [companyUrl]);

  const signIn = useCallback(async (identifier: string, password: string): Promise<SignInResult> => {
    if (!companyUrl) {
      return { ok: false, message: 'Set your company URL before signing in.' };
    }

    try {
      const sessionId = await signInToFrappe(companyUrl, identifier, password);
      await persistSessionId(sessionId);
      setSessionId(sessionId);
      setAuthState('signedIn');
      return { ok: true };
    } catch (error) {
      const message = error instanceof FrappeClientError
        ? error.message
        : 'Could not complete sign-in.';
      return { ok: false, message };
    }
  }, [companyUrl]);

  const signOut = useCallback(async () => {
    await clearStoredSession();
    setSessionId(null);
    setAuthState(companyUrl ? 'signedOut' : 'needsCompanyUrl');
  }, [companyUrl]);

  const invalidateSession = useCallback(async () => {
    await clearStoredSession();
    setSessionId(null);
    setAuthState(companyUrl ? 'sessionExpired' : 'needsCompanyUrl');
  }, [companyUrl]);

  const value = useMemo(() => ({
    authState,
    clearCompanyUrl,
    companyUrl,
    invalidateSession,
    isBootstrapping,
    saveCompanyUrl,
    sessionId,
    signIn,
    signOut,
  }), [authState, clearCompanyUrl, companyUrl, invalidateSession, isBootstrapping, saveCompanyUrl, sessionId, signIn, signOut]);

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const context = useContext(AppSessionContext);
  if (!context) {
    throw new Error('useAppSession must be used inside AppSessionProvider.');
  }
  return context;
}
